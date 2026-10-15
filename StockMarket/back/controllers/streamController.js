// Browser-facing WebSocket at /api/livedata/stream. Relays the shared Alpaca stream.
//
// Client → server: { "action": "subscribe" | "unsubscribe", "symbols": ["AAPL", "MSFT"] }
// Server → client:
//   { "type": "status", "state": "live", "message": "", "feed": "iex" }
//   { "type": "subscribed", "symbols": [...] }            current subscription after each change
//   { "type": "trades", "data": [{ symbol, price, size, volume, t }] }   throttled, latest per symbol
//   { "type": "bar", "symbol": "AAPL", "bar": { t, o, h, l, c, v } }     1-minute bar
//   { "type": "error", "message": "..." }
import { WebSocketServer } from 'ws'
import { alpacaStream } from '../services/alpacaStream.js'
import { parseSymbol } from './liveDataController.js'

export const STREAM_PATH = '/api/livedata/stream'
const FLUSH_MS = 250
const HEARTBEAT_MS = 30e3
const MAX_SYMBOLS_PER_CLIENT = 30

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
  const clients = new Map() // socket -> Set<symbol>

  // Busy symbols can trade many times per second; send each client at most one update per symbol per flush.
  let pending = new Map()
  alpacaStream.on('trade', (trade) => {
    const prev = pending.get(trade.symbol)
    pending.set(trade.symbol, { ...trade, volume: (prev?.volume ?? 0) + trade.size })
  })
  const flushTimer = setInterval(() => {
    if (!pending.size) return
    const batch = pending
    pending = new Map()
    for (const [socket, symbols] of clients) {
      const data = [...symbols].filter((s) => batch.has(s)).map((s) => batch.get(s))
      if (data.length) send(socket, { type: 'trades', data })
    }
  }, FLUSH_MS)

  alpacaStream.on('bar', ({ symbol, bar }) => {
    for (const [socket, symbols] of clients) if (symbols.has(symbol)) send(socket, { type: 'bar', symbol, bar })
  })
  alpacaStream.on('status', (status) => {
    for (const socket of clients.keys()) send(socket, { type: 'status', ...status })
  })
  alpacaStream.on('upstreamError', ({ message }) => {
    for (const socket of clients.keys()) send(socket, { type: 'error', message: `Alpaca: ${message}` })
  })

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
    const symbols = new Set()
    clients.set(socket, symbols)
    socket.isAlive = true
    socket.on('pong', () => (socket.isAlive = true))
    send(socket, { type: 'status', state: alpacaStream.state, message: alpacaStream.message, feed: alpacaStream.feed })

    socket.on('message', (raw) => {
      let msg
      try {
        msg = JSON.parse(raw)
        if (!['subscribe', 'unsubscribe'].includes(msg.action) || !Array.isArray(msg.symbols)) throw new Error()
      } catch {
        return send(socket, { type: 'error', message: 'Expected { "action": "subscribe" | "unsubscribe", "symbols": [...] }' })
      }

      let requested
      try {
        requested = [...new Set(msg.symbols.map(parseSymbol))]
      } catch (err) {
        return send(socket, { type: 'error', message: err.message })
      }

      if (msg.action === 'subscribe') {
        const fresh = requested.filter((s) => !symbols.has(s))
        if (symbols.size + fresh.length > MAX_SYMBOLS_PER_CLIENT) {
          return send(socket, { type: 'error', message: `At most ${MAX_SYMBOLS_PER_CLIENT} symbols per connection` })
        }
        fresh.forEach((s) => symbols.add(s))
        if (fresh.length) alpacaStream.add(fresh)
      } else {
        const gone = requested.filter((s) => symbols.delete(s))
        if (gone.length) alpacaStream.remove(gone)
      }
      send(socket, { type: 'subscribed', symbols: [...symbols] })
    })

    socket.on('close', () => {
      clients.delete(socket)
      if (symbols.size) alpacaStream.remove([...symbols])
    })
  })

  wss.on('close', () => {
    clearInterval(flushTimer)
    clearInterval(heartbeat)
  })
  return wss
}
