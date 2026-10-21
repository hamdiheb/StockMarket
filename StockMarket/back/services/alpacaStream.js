// Real-time trades from Alpaca (https://docs.alpaca.markets/docs/streaming-market-data).
// Stocks and crypto are separate endpoints with the same message format. Most plans allow
// ONE connection per endpoint per account, so every browser shares these.
import { UpstreamStream } from './upstreamStream.js'

const FATAL_CODES = new Set([402, 409]) // bad keys / feed not in plan: retrying won't help
const CONNECTION_LIMIT_BACKOFF_MS = 15e3

class AlpacaStream extends UpstreamStream {
  // baseUrl() and feed are per endpoint: the socket URL is `${baseUrl()}/${feed}`.
  // quotePrices: also stream quotes and relay each bid/ask midpoint as a price update.
  constructor(provider, { baseUrl, feed, quotePrices = false }) {
    super(provider)
    this.baseUrl = baseUrl
    this.feedOf = feed
    this.quotePrices = quotePrices
  }

  get feed() {
    return this.feedOf()
  }

  url() {
    if (!process.env.ALPACA_KEY_ID || !process.env.ALPACA_SECRET_KEY) {
      this.setState('error', 'Alpaca API keys are not configured on the server')
      return null
    }
    return `${this.baseUrl()}/${this.feed}`
  }

  channels(symbols) {
    return { trades: symbols, bars: symbols, ...(this.quotePrices && { quotes: symbols }) }
  }

  subscribe(symbols) {
    this.send({ action: 'subscribe', ...this.channels(symbols) })
  }

  unsubscribe(symbols) {
    this.send({ action: 'unsubscribe', ...this.channels(symbols) })
  }

  onMessage(messages) {
    for (const msg of messages) {
      switch (msg.T) {
        case 't':
          this.emit('trade', { symbol: msg.S, price: msg.p, size: msg.s, t: Date.parse(msg.t) })
          break
        case 'q':
          // A quote moves the price but adds no volume.
          if (msg.bp > 0 && msg.ap > 0) this.emit('trade', { symbol: msg.S, price: (msg.bp + msg.ap) / 2, size: 0, t: Date.parse(msg.t) })
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
    console.warn(`${this.provider} stream error ${code}: ${msg}`)
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

export const alpacaStream = new AlpacaStream('alpaca', {
  baseUrl: () => process.env.ALPACA_STREAM_URL || 'wss://stream.data.alpaca.markets/v2',
  feed: () => process.env.ALPACA_STREAM_FEED || process.env.ALPACA_FEED || 'iex',
})

export const alpacaCryptoStream = new AlpacaStream('alpacaCrypto', {
  baseUrl: () => process.env.ALPACA_CRYPTO_STREAM_URL || 'wss://stream.data.alpaca.markets/v1beta3/crypto',
  feed: () => 'us',
  // Crypto trades on Alpaca's venue are minutes apart; quotes keep the price moving.
  quotePrices: true,
})
