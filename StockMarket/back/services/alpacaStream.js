// Single upstream connection to Alpaca's real-time stock stream
// (https://docs.alpaca.markets/docs/streaming-market-data).
// Most plans allow ONE connection per account, so every browser shares this one.
import { EventEmitter } from 'node:events'

const FATAL_CODES = new Set([402, 409]) // bad keys / feed not in plan: retrying won't help
const MAX_BACKOFF_MS = 30e3
const CONNECTION_LIMIT_BACKOFF_MS = 15e3

class AlpacaStream extends EventEmitter {
  state = 'idle' // idle | connecting | live | reconnecting | error
  message = ''
  ws = null
  retries = 0
  retryTimer = null
  fatal = false
  wanted = new Map() // symbol -> number of browser subscriptions

  get feed() {
    return process.env.ALPACA_STREAM_FEED || process.env.ALPACA_FEED || 'iex'
  }

  get symbols() {
    return [...this.wanted.keys()]
  }

  setState(state, message = '') {
    this.state = state
    this.message = message
    this.emit('status', { state, message, feed: this.feed })
  }

  send(payload) {
    if (this.ws?.readyState === WebSocket.OPEN) this.ws.send(JSON.stringify(payload))
  }

  connect() {
    if (this.ws || this.retryTimer || this.fatal) return
    if (!process.env.ALPACA_KEY_ID || !process.env.ALPACA_SECRET_KEY) {
      return this.setState('error', 'Alpaca API keys are not configured on the server')
    }
    const base = process.env.ALPACA_STREAM_URL || 'wss://stream.data.alpaca.markets/v2'
    this.setState('connecting')
    const ws = new WebSocket(`${base}/${this.feed}`)
    this.ws = ws
    ws.onmessage = (event) => {
      for (const msg of JSON.parse(event.data)) this.handle(msg)
    }
    ws.onclose = () => {
      this.ws = null
      this.scheduleReconnect()
    }
    ws.onerror = () => {} // a close event always follows; reconnect happens there
  }

  handle(msg) {
    switch (msg.T) {
      case 't':
        this.emit('trade', { symbol: msg.S, price: msg.p, size: msg.s, t: Date.parse(msg.t) })
        break
      case 'b':
        this.emit('bar', { symbol: msg.S, bar: { t: Date.parse(msg.t), o: msg.o, h: msg.h, l: msg.l, c: msg.c, v: msg.v } })
        break
      case 'success':
        if (msg.msg === 'connected') {
          this.send({ action: 'auth', key: process.env.ALPACA_KEY_ID, secret: process.env.ALPACA_SECRET_KEY })
        } else if (msg.msg === 'authenticated') {
          this.retries = 0
          this.setState('live')
          if (this.wanted.size) this.send({ action: 'subscribe', trades: this.symbols, bars: this.symbols })
        }
        break
      case 'error':
        this.onError(msg)
        break
      // 'subscription' acks and other channels need no handling
    }
  }

  onError({ code, msg }) {
    console.warn(`Alpaca stream error ${code}: ${msg}`)
    if (FATAL_CODES.has(code)) {
      this.fatal = true
      this.setState('error', `Alpaca: ${msg}`)
      this.ws?.close()
    } else if (code === 406) {
      this.setState('error', 'Alpaca connection limit reached — another process is using this account’s stream')
    } else {
      this.emit('upstreamError', { code, message: msg }) // e.g. 405 symbol limit: relay to clients
    }
  }

  scheduleReconnect() {
    if (this.fatal) return
    if (!this.wanted.size) {
      if (this.state !== 'error') this.setState('idle')
      return
    }
    const backoff = Math.min(MAX_BACKOFF_MS, 1000 * 2 ** this.retries++)
    const delay = this.message.includes('connection limit') ? Math.max(backoff, CONNECTION_LIMIT_BACKOFF_MS) : backoff
    if (this.state !== 'error') this.setState('reconnecting', `Retrying in ${Math.round(delay / 1000)}s`)
    this.retryTimer = setTimeout(() => {
      this.retryTimer = null
      this.connect()
    }, delay)
  }

  // Ref-counted so a symbol stays subscribed while any browser still watches it.
  add(symbols) {
    const fresh = symbols.filter((s) => !this.wanted.has(s))
    for (const s of symbols) this.wanted.set(s, (this.wanted.get(s) ?? 0) + 1)
    if (this.state === 'live' && fresh.length) this.send({ action: 'subscribe', trades: fresh, bars: fresh })
    else this.connect()
  }

  remove(symbols) {
    const gone = []
    for (const s of symbols) {
      const count = (this.wanted.get(s) ?? 0) - 1
      if (count > 0) this.wanted.set(s, count)
      else if (this.wanted.delete(s)) gone.push(s)
    }
    if (this.state === 'live' && gone.length) this.send({ action: 'unsubscribe', trades: gone, bars: gone })
  }

  close() {
    this.fatal = true
    clearTimeout(this.retryTimer)
    this.ws?.close()
  }
}

export const alpacaStream = new AlpacaStream()
