import { useCallback, useEffect, useMemo, useState } from 'react'
import { SIM_ASSETS, gaussian, generateCandles, stockAsset } from '../data/markets'
import { STREAM_URL, fetchBars, fetchStocks } from '../lib/api'

const SIM_TICK_MS = 1600
const SNAPSHOT_REFRESH_MS = 60e3
const SPARK_POINTS = 48

function initialSimQuotes() {
  const quotes = {}
  for (const asset of SIM_ASSETS) {
    const day = generateCandles(asset, '1D')
    quotes[asset.symbol] = {
      price: asset.price,
      open: day[0].o,
      prevClose: day[0].o,
      high: Math.max(...day.map((c) => c.h)),
      low: Math.min(...day.map((c) => c.l)),
      volume: day.reduce((sum, c) => sum + c.v, 0),
      spark: day.filter((_, i) => i % 2 === 1).map((c) => c.c),
      dir: 0,
      tick: 0,
    }
  }
  return quotes
}

function sample(values, n) {
  if (values.length <= n) return values
  return Array.from({ length: n }, (_, i) => values[Math.round((i / (n - 1)) * (values.length - 1))])
}

// Merges a REST snapshot into the existing quote, keeping the live-only fields.
function fromSnapshot(s, prev) {
  return {
    spark: [s.prevClose ?? s.price, s.price],
    dir: 0,
    tick: 0,
    ...prev,
    price: s.price,
    open: s.open ?? s.price,
    prevClose: s.prevClose ?? s.open ?? s.price,
    high: s.high ?? s.price,
    low: s.low ?? s.price,
    volume: s.volume ?? 0,
    updatedAt: s.updatedAt,
  }
}

function applyTrades(prev, trades) {
  const next = { ...prev }
  for (const tr of trades) {
    const q = next[tr.symbol]
    if (!q) continue
    next[tr.symbol] = {
      ...q,
      price: tr.price,
      high: Math.max(q.high, tr.price),
      low: Math.min(q.low, tr.price),
      volume: q.volume + tr.volume,
      spark: [...q.spark.slice(0, -1), tr.price],
      dir: tr.price > q.price ? 1 : tr.price < q.price ? -1 : q.dir,
      tick: q.tick + 1,
      updatedAt: new Date(tr.t).toISOString(),
    }
  }
  return next
}

// Live stocks (REST snapshot + WebSocket trades) and simulated currencies / crypto.
export function useMarket() {
  const [quotes, setQuotes] = useState(initialSimQuotes)
  const [stockAssets, setStockAssets] = useState([])
  const [stocks, setStocks] = useState({ status: 'loading', error: null, market: null, feed: null })
  const [stream, setStream] = useState({ state: 'connecting', message: '' })

  // Simulated feed for currencies and crypto.
  useEffect(() => {
    const id = setInterval(() => {
      setQuotes((prev) => {
        const next = { ...prev }
        for (const asset of SIM_ASSETS) {
          if (Math.random() > 0.45) continue
          const q = prev[asset.symbol]
          const price = q.price * Math.exp(gaussian() * asset.vol * 0.025)
          next[asset.symbol] = {
            ...q,
            price,
            high: Math.max(q.high, price),
            low: Math.min(q.low, price),
            volume: q.volume + asset.adv * 0.0004 * Math.random(),
            spark: [...q.spark.slice(1), price],
            dir: price >= q.price ? 1 : -1,
            tick: q.tick + 1,
          }
        }
        return next
      })
    }, SIM_TICK_MS)
    return () => clearInterval(id)
  }, [])

  // Stock snapshot on load, refreshed every minute (keeps open/prev close/market clock correct).
  const [reloadKey, setReloadKey] = useState(0)
  useEffect(() => {
    const ctrl = new AbortController()
    let sparksLoaded = false

    async function load() {
      try {
        const data = await fetchStocks({ signal: ctrl.signal })
        const live = data.quotes.filter((q) => q.price != null)
        setStockAssets((prev) => {
          const next = live.map(stockAsset)
          return JSON.stringify(prev) === JSON.stringify(next) ? prev : next
        })
        setQuotes((prev) => {
          const next = { ...prev }
          for (const s of live) next[s.symbol] = fromSnapshot(s, prev[s.symbol])
          return next
        })
        setStocks({ status: 'ready', error: null, market: data.market, feed: data.feed })

        if (!sparksLoaded) {
          sparksLoaded = true
          // Intraday trend lines for the cards, from the 1D bars.
          await Promise.allSettled(
            live.map(async (s) => {
              const { bars } = await fetchBars(s.symbol, '1D', { signal: ctrl.signal })
              if (!bars.length) return
              const spark = sample(bars.map((b) => b.c), SPARK_POINTS)
              setQuotes((prev) => (prev[s.symbol] ? { ...prev, [s.symbol]: { ...prev[s.symbol], spark: [...spark.slice(0, -1), prev[s.symbol].price] } } : prev))
            }),
          )
        }
      } catch (err) {
        if (err.name === 'AbortError') return
        setStocks((prev) => ({ ...prev, status: prev.status === 'ready' ? 'ready' : 'error', error: err.message }))
      }
    }

    load()
    const id = setInterval(load, SNAPSHOT_REFRESH_MS)
    return () => {
      ctrl.abort()
      clearInterval(id)
    }
  }, [reloadKey])

  // Real-time trades over the back end's WebSocket, reconnecting with backoff.
  const symbolKey = stockAssets.map((a) => a.symbol).join(',')
  useEffect(() => {
    if (!symbolKey) return
    let ws
    let retry = 0
    let timer
    let closed = false

    function connect() {
      ws = new WebSocket(STREAM_URL)
      ws.onopen = () => {
        retry = 0
        ws.send(JSON.stringify({ action: 'subscribe', symbols: symbolKey.split(',') }))
      }
      ws.onmessage = (event) => {
        const msg = JSON.parse(event.data)
        if (msg.type === 'trades') setQuotes((prev) => applyTrades(prev, msg.data))
        else if (msg.type === 'status') setStream({ state: msg.state, message: msg.message })
        else if (msg.type === 'bar') {
          setQuotes((prev) => {
            const q = prev[msg.symbol]
            return q ? { ...prev, [msg.symbol]: { ...q, spark: [...q.spark.slice(1, -1), msg.bar.c, q.price] } } : prev
          })
        } else if (msg.type === 'error') console.warn('Live stream:', msg.message)
      }
      ws.onclose = () => {
        if (closed) return
        const delay = Math.min(30e3, 1000 * 2 ** retry++)
        setStream({ state: 'reconnecting', message: `Can't reach the live stream, retrying in ${Math.round(delay / 1000)}s` })
        timer = setTimeout(connect, delay)
      }
    }

    connect()
    return () => {
      closed = true
      clearTimeout(timer)
      ws?.close()
    }
  }, [symbolKey])

  const assets = useMemo(() => [...stockAssets, ...SIM_ASSETS], [stockAssets])
  const bySymbol = useMemo(() => Object.fromEntries(assets.map((a) => [a.symbol, a])), [assets])
  const retryStocks = useCallback(() => {
    setStocks((prev) => ({ ...prev, status: 'loading', error: null }))
    setReloadKey((k) => k + 1)
  }, [])

  return { assets, bySymbol, quotes, stocks, stream, retryStocks }
}

// Candles for a chart: fetched from the API for stocks, simulated for everything else.
// `anchor` pins the simulated walk's end price; it's ignored for live stocks.
export function useCandles(asset, range, anchor) {
  const live = asset.type === 'stock'
  const key = `${asset.symbol}:${range}`
  const [state, setState] = useState({ key: null, candles: null, error: null })

  const simulated = useMemo(() => (live ? null : generateCandles(asset, range, anchor)), [live, asset, range, anchor])

  useEffect(() => {
    if (!live) return
    const ctrl = new AbortController()
    const load = () =>
      fetchBars(asset.symbol, range, { signal: ctrl.signal })
        .then((data) => setState({ key, candles: data.bars, error: null }))
        .catch((err) => err.name !== 'AbortError' && setState((prev) => ({ ...prev, key, error: err.message })))
    load()
    // Intraday charts pick up new 5-minute candles while open.
    const id = range === '1D' ? setInterval(load, 60e3) : null
    return () => {
      ctrl.abort()
      clearInterval(id)
    }
  }, [live, asset.symbol, range, key])

  if (!live) return { candles: simulated, loading: false, error: null }
  const current = state.key === key
  return {
    candles: current ? state.candles : null,
    loading: !current || (!state.candles && !state.error),
    error: current ? state.error : null,
  }
}

// Replaces the last candle's close with the live price.
export function withLivePrice(candles, price) {
  if (!candles?.length || price == null) return candles
  const next = candles.slice()
  const tail = { ...next[next.length - 1] }
  tail.c = price
  tail.h = Math.max(tail.h, price)
  tail.l = Math.min(tail.l, price)
  next[next.length - 1] = tail
  return next
}

const WATCH_KEY = 'stockmarket.watchlist'

export function useWatchlist() {
  const [list, setList] = useState(() => {
    try {
      return JSON.parse(localStorage.getItem(WATCH_KEY)) ?? ['NVDA', 'BTC', 'EUR/USD']
    } catch {
      return ['NVDA', 'BTC', 'EUR/USD']
    }
  })

  const toggle = useCallback((symbol) => {
    setList((prev) => {
      const next = prev.includes(symbol) ? prev.filter((s) => s !== symbol) : [...prev, symbol]
      try {
        localStorage.setItem(WATCH_KEY, JSON.stringify(next))
      } catch {
        // storage unavailable: keep in-memory only
      }
      return next
    })
  }, [])

  return [list, toggle]
}
