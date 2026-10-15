// Real-time forex prices from Finnhub (https://finnhub.io/docs/api/websocket-trades).
// Pairs are streamed from OANDA: "EUR/USD" ⇄ "OANDA:EUR_USD".
import { UpstreamStream } from './upstreamStream.js'

const toFinnhub = (pair) => `OANDA:${pair.replace('/', '_')}`
const fromFinnhub = (symbol) => symbol.replace(/^OANDA:/, '').replace('_', '/')

class FinnhubStream extends UpstreamStream {
  feed = 'oanda'

  url() {
    const key = process.env.FINNHUB_API_KEY
    if (!key) {
      this.setState('error', 'Finnhub API key is not configured on the server')
      return null
    }
    return `wss://ws.finnhub.io?token=${encodeURIComponent(key)}`
  }

  // Finnhub authenticates in the URL: an open socket is ready for subscriptions.
  onOpen() {
    this.ready()
  }

  subscribe(pairs) {
    for (const pair of pairs) this.send({ type: 'subscribe', symbol: toFinnhub(pair) })
  }

  unsubscribe(pairs) {
    for (const pair of pairs) this.send({ type: 'unsubscribe', symbol: toFinnhub(pair) })
  }

  onMessage(msg) {
    if (msg.type === 'trade') {
      for (const d of msg.data ?? []) {
        this.emit('trade', { symbol: fromFinnhub(d.s), price: d.p, size: d.v || 0, t: d.t })
      }
    } else if (msg.type === 'error') {
      console.warn(`Finnhub stream error: ${msg.msg}`)
      // Pairs OANDA doesn't carry (e.g. EUR/TND) just get no live ticks; the snapshot still prices them.
      if (!/invalid symbol/i.test(msg.msg ?? '')) this.emit('upstreamError', { message: `Finnhub: ${msg.msg}` })
    }
    // 'ping' keep-alives need no reply
  }

  scheduleReconnect() {
    // Finnhub rejects a bad key by closing the handshake, which looks like any other drop.
    if (this.retries >= 3 && this.state !== 'error') {
      this.setState('error', 'Can’t connect to Finnhub — check FINNHUB_API_KEY')
    }
    super.scheduleReconnect()
  }
}

export const finnhubStream = new FinnhubStream('finnhub')
