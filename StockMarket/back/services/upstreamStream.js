// Shared plumbing for one long-lived upstream WebSocket (Alpaca, Finnhub):
// ref-counted symbol subscriptions, status events and reconnect with backoff.
// Subclasses implement url(), onMessage(data), subscribe(symbols), unsubscribe(symbols),
// and call ready() once the upstream accepts subscriptions.
import { EventEmitter } from 'node:events'

const MAX_BACKOFF_MS = 30e3

export class UpstreamStream extends EventEmitter {
  state = 'idle' // idle | connecting | live | reconnecting | error
  message = ''
  ws = null
  retries = 0
  retryTimer = null
  retryFloorMs = 0
  fatal = false
  wanted = new Map() // symbol -> number of browser subscriptions

  constructor(provider) {
    super()
    this.provider = provider
  }

  get symbols() {
    return [...this.wanted.keys()]
  }

  get info() {
    return { provider: this.provider, state: this.state, message: this.message, feed: this.feed }
  }

  setState(state, message = '') {
    this.state = state
    this.message = message
    this.emit('status', this.info)
  }

  send(payload) {
    if (this.ws?.readyState === WebSocket.OPEN) this.ws.send(JSON.stringify(payload))
  }

  connect() {
    if (this.ws || this.retryTimer || this.fatal) return
    const url = this.url()
    if (!url) return
    this.setState('connecting')
    const ws = new WebSocket(url)
    this.ws = ws
    ws.onopen = () => this.onOpen()
    ws.onmessage = (event) => {
      let data
      try {
        data = JSON.parse(event.data)
      } catch {
        return
      }
      this.onMessage(data)
    }
    ws.onclose = () => {
      this.ws = null
      this.scheduleReconnect()
    }
    ws.onerror = () => {} // a close event always follows; reconnect happens there
  }

  onOpen() {}

  ready() {
    this.retries = 0
    this.retryFloorMs = 0
    this.setState('live')
    if (this.wanted.size) this.subscribe(this.symbols)
  }

  // Permanent failure (bad credentials, plan doesn't include the feed): stop retrying.
  fail(message) {
    this.fatal = true
    this.setState('error', message)
    this.ws?.close()
  }

  scheduleReconnect() {
    if (this.fatal) return
    if (!this.wanted.size) {
      if (this.state !== 'error') this.setState('idle')
      return
    }
    const delay = Math.max(this.retryFloorMs, Math.min(MAX_BACKOFF_MS, 1000 * 2 ** this.retries++))
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
    if (this.state === 'live' && fresh.length) this.subscribe(fresh)
    else this.connect()
  }

  remove(symbols) {
    const gone = []
    for (const s of symbols) {
      const count = (this.wanted.get(s) ?? 0) - 1
      if (count > 0) this.wanted.set(s, count)
      else if (this.wanted.delete(s)) gone.push(s)
    }
    if (this.state === 'live' && gone.length) this.unsubscribe(gone)
  }

  close() {
    this.fatal = true
    clearTimeout(this.retryTimer)
    this.ws?.close()
  }
}
