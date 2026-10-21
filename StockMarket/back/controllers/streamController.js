// Browser-facing WebSocket at /api/livedata/stream. Relays the shared upstream streams:
// stock symbols ("AAPL") go to Alpaca stocks, crypto pairs Alpaca lists ("BTC/USD") go to
// Alpaca crypto, and other currency pairs ("EUR/USD") go to Finnhub.
//
// Client → server: { "action": "subscribe" | "unsubscribe", "symbols": ["AAPL", "EUR/USD"] }
// Server → client:
//   { "type": "status", "provider": "alpaca" | "alpacaCrypto" | "finnhub", "state": "live", "message": "", "feed": "iex" }
//   { "type": "subscribed", "symbols": [...] }            current subscription after each change
//   { "type": "trades", "data": [{ symbol, price, size, volume, t }] }   throttled, latest per symbol
//   { "type": "bar", "symbol": "AAPL", "bar": { t, o, h, l, c, v } }     1-minute bar (stocks and crypto)
//   { "type": "error", "message": "..." }
import { WebSocketServer } from 'ws'
import { getCryptoAssets } from '../services/alpaca.js'
import { alpacaCryptoStream, alpacaStream } from '../services/alpacaStream.js'
import { finnhubStream } from '../services/finnhubStream.js'
import { DEFAULT_CRYPTO } from './cryptoController.js'
import { PAIR_RE } from './forexController.js'
import { parseSymbol } from './liveDataController.js'

export const STREAM_PATH = '/api/livedata/stream'
export const UPSTREAMS = [alpacaStream, alpacaCryptoStream, finnhubStream]
const FLUSH_MS = 250
const HEARTBEAT_MS = 30e3
const MAX_SYMBOLS_PER_CLIENT = 30

// "BTC/USD" looks like a currency pair, so crypto is told apart by Alpaca's asset list.
// If that lookup fails, the default pairs still route correctly.
const cryptoPairs = () => getCryptoAssets().then((names) => new Set(Object.keys(names)), () => new Set(DEFAULT_CRYPTO))

// Validates a requested symbol and picks its upstream.
function route(value, crypto) {
  const s = String(value).trim().toUpperCase()
  if (crypto.has(s)) return [s, alpacaCryptoStream]
  if (PAIR_RE.test(s)) return [s, finnhubStream]
  return [parseSymbol(s), alpacaStream]
}

// Applies fn(upstream, symbols) once per upstream. `entries` are [symbol, upstream] pairs.
function byUpstream(entries, fn) {
  const groups = new Map()
  for (const [s, up] of entries) groups.set(up, [...(groups.get(up) ?? []), s])
  for (const [up, list] of groups) fn(up, list)
}

function send(socket, payload) {
  if (socket.readyState === socket.OPEN) socket.send(JSON.stringify(payload))
}

export function attachLiveStream(server, allowedOrigins) {
  const wss = new WebSocketServer({
    server,
    path: STREAM_PATH,
    // Same rule as CORS: only our front end (or non-browser tools that send no Origin).
    verifyClient: ({ origin }) => !origin || allowedOrigins.includes(origin),
  })
  const clients = new Map() // socket -> Map<symbol, upstream>
  cryptoPairs() // warm the cache before the first subscription

  // Busy symbols can trade many times per second; send each client at most one update per symbol per flush.
  let pending = new Map()
  const flushTimer = setInterval(() => {
    if (!pending.size) return
    const batch = pending
    pending = new Map()
    for (const [socket, symbols] of clients) {
      const data = [...symbols.keys()].filter((s) => batch.has(s)).map((s) => batch.get(s))
      if (data.length) send(socket, { type: 'trades', data })
    }
  }, FLUSH_MS)

  for (const upstream of UPSTREAMS) {
    upstream.on('trade', (trade) => {
      const prev = pending.get(trade.symbol)
      pending.set(trade.symbol, { ...trade, volume: (prev?.volume ?? 0) + trade.size })
    })
    upstream.on('bar', ({ symbol, bar }) => {
      for (const [socket, symbols] of clients) if (symbols.has(symbol)) send(socket, { type: 'bar', symbol, bar })
    })
    upstream.on('status', (status) => {
      for (const socket of clients.keys()) send(socket, { type: 'status', ...status })
    })
    upstream.on('upstreamError', ({ message }) => {
      for (const socket of clients.keys()) send(socket, { type: 'error', message })
    })
  }

  // Drop browsers that vanished without closing (sleeping laptop, dropped Wi-Fi).
  const heartbeat = setInterval(() => {
    for (const socket of clients.keys()) {
      if (!socket.isAlive) socket.terminate()
      else {
        socket.isAlive = false
        socket.ping()
      }
    }
  }, HEARTBEAT_MS)

  wss.on('connection', (socket) => {
    const symbols = new Map()
    clients.set(socket, symbols)
    socket.isAlive = true
    socket.on('pong', () => (socket.isAlive = true))
    for (const upstream of UPSTREAMS) send(socket, { type: 'status', ...upstream.info })

    // Routing is async (crypto lookup), so handle each socket's messages strictly in order.
    let queue = Promise.resolve()
    socket.on('message', (raw) => {
      queue = queue.then(() => handle(raw))
    })

    async function handle(raw) {
      let msg
      try {
        msg = JSON.parse(raw)
        if (!['subscribe', 'unsubscribe'].includes(msg.action) || !Array.isArray(msg.symbols)) throw new Error()
      } catch {
        return send(socket, { type: 'error', message: 'Expected { "action": "subscribe" | "unsubscribe", "symbols": [...] }' })
      }

      let requested
      try {
        const crypto = await cryptoPairs()
        requested = [...new Map(msg.symbols.map((s) => route(s, crypto)))]
      } catch (err) {
        return send(socket, { type: 'error', message: err.message })
      }
      if (!clients.has(socket)) return // closed while routing

      if (msg.action === 'subscribe') {
        const fresh = requested.filter(([s]) => !symbols.has(s))
        if (symbols.size + fresh.length > MAX_SYMBOLS_PER_CLIENT) {
          return send(socket, { type: 'error', message: `At most ${MAX_SYMBOLS_PER_CLIENT} symbols per connection` })
        }
        fresh.forEach(([s, up]) => symbols.set(s, up))
        byUpstream(fresh, (up, list) => up.add(list))
      } else {
        // Unsubscribe from whichever upstream the symbol was subscribed on.
        const gone = requested.filter(([s]) => symbols.has(s)).map(([s]) => [s, symbols.get(s)])
        gone.forEach(([s]) => symbols.delete(s))
        byUpstream(gone, (up, list) => up.remove(list))
      }
      send(socket, { type: 'subscribed', symbols: [...symbols.keys()] })
    }

    socket.on('close', () => {
      clients.delete(socket)
      byUpstream([...symbols], (up, list) => up.remove(list))
    })
  })

  wss.on('close', () => {
    clearInterval(flushTimer)
    clearInterval(heartbeat)
  })
  return wss
}
