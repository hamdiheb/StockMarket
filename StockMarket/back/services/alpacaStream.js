// Real-time stock trades from Alpaca (https://docs.alpaca.markets/docs/streaming-market-data).
// Most plans allow ONE connection per account, so every browser shares this one.
import { UpstreamStream } from './upstreamStream.js'

const FATAL_CODES = new Set([402, 409]) // bad keys / feed not in plan: retrying won't help
const CONNECTION_LIMIT_BACKOFF_MS = 15e3

class AlpacaStream extends UpstreamStream {
  get feed() {
    return process.env.ALPACA_STREAM_FEED || process.env.ALPACA_FEED || 'iex'
  }

  url() {
    if (!process.env.ALPACA_KEY_ID || !process.env.ALPACA_SECRET_KEY) {
      this.setState('error', 'Alpaca API keys are not configured on the server')
      return null
    }
    return `${process.env.ALPACA_STREAM_URL || 'wss://stream.data.alpaca.markets/v2'}/${this.feed}`
  }

  subscribe(symbols) {
    this.send({ action: 'subscribe', trades: symbols, bars: symbols })
  }

  unsubscribe(symbols) {
    this.send({ action: 'unsubscribe', trades: symbols, bars: symbols })
  }

  onMessage(messages) {
    for (const msg of messages) {
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
            this.ready()
          }
          break
        case 'error':
          this.onError(msg)
          break
        // 'subscription' acks and other channels need no handling
      }
    }
  }

  onError({ code, msg }) {
    console.warn(`Alpaca stream error ${code}: ${msg}`)
    if (FATAL_CODES.has(code)) {
      this.fail(`Alpaca: ${msg}`)
    } else if (code === 406) {
      this.retryFloorMs = CONNECTION_LIMIT_BACKOFF_MS
      this.setState('error', 'Alpaca connection limit reached — another process is using this account’s stream')
    } else {
      this.emit('upstreamError', { code, message: `Alpaca: ${msg}` }) // e.g. 405 symbol limit
    }
  }
}

export const alpacaStream = new AlpacaStream('alpaca')
