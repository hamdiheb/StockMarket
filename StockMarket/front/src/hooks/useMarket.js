import { useCallback, useEffect, useMemo, useState } from 'react'
import { cryptoAsset, forexAsset, stockAsset } from '../data/markets'
import { STREAM_URL, fetchBars, fetchCrypto, fetchForex, fetchStocks } from '../lib/api'

const SNAPSHOT_REFRESH_MS = 60e3
const SPARK_POINTS = 48
const STREAM_PROVIDERS = ['alpaca', 'alpacaCrypto', 'finnhub']

// Live data sources. Forex snapshots already include a 24h trend line; stocks and crypto fetch theirs from 1D bars.
const SOURCES = {
  stock: { fetchList: fetchStocks, toAsset: stockAsset, loadSparks: true },
  forex: { fetchList: fetchForex, toAsset: forexAsset, loadSparks: false },
  crypto: { fetchList: fetchCrypto, toAsset: cryptoAsset, loadSparks: true },
}

function sample(values, n) {
  if (values.length <= n) return values
  return Array.from({ length: n }, (_, i) => values[Math.round((i / (n - 1)) * (values.length - 1))])
}

// Merges a REST snapshot into the existing quote. Snapshots can be cached server-side for
// minutes, so a newer price that arrived over the live stream always wins.
function fromSnapshot(s, prev) {
  const liveIsNewer = Boolean(prev?.updatedAt && s.updatedAt && Date.parse(prev.updatedAt) > Date.parse(s.updatedAt))
  const price = liveIsNewer ? prev.price : s.price
  return {
    dir: 0,
    tick: 0,
    ...prev,
    spark: s.spark?.length ? [...s.spark.slice(0, -1), price] : (prev?.spark ?? [s.prevClose ?? price, price]),
    price,
    open: s.open ?? price,
    prevClose: s.prevClose ?? s.open ?? price,
    high: Math.max(s.high ?? price, liveIsNewer ? prev.high : price),
    low: Math.min(s.low ?? price, liveIsNewer ? prev.low : price),
    volume: s.volume ?? prev?.volume ?? null,
    updatedAt: liveIsNewer ? prev.updatedAt : s.updatedAt,
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
      volume: q.volume == null ? null : q.volume + tr.volume,
      spark: [...q.spark.slice(0, -1), tr.price],
      dir: tr.price > q.price ? 1 : tr.price < q.price ? -1 : q.dir,
      tick: q.tick + 1,
      updatedAt: new Date(tr.t).toISOString(),
    }
  }
  return next
}

// Loads one live source (stocks, forex or crypto) on mount and refreshes it every minute.
function useLiveSource(type, setQuotes) {
  const { fetchList, toAsset, loadSparks } = SOURCES[type]
  const [assets, setAssets] = useState([])
  const [status, setStatus] = useState({ status: 'loading', error: null, market: null, feed: null })
  const [reloadKey, setReloadKey] = useState(0)

  useEffect(() => {
    const ctrl = new AbortController()
    let sparksLoaded = false

    async function load() {
      try {
        const data = await fetchList({ signal: ctrl.signal })
        const live = data.quotes.filter((q) => q.price != null)
        const nextAssets = live.map(toAsset)
        setAssets((prev) => (JSON.stringify(prev) === JSON.stringify(nextAssets) ? prev : nextAssets))
        setQuotes((prev) => {
          const next = { ...prev }
          for (const s of live) next[s.symbol] = fromSnapshot(s, prev[s.symbol])
          return next
        })
        setStatus({ status: 'ready', error: null, market: data.market ?? null, feed: data.feed ?? null })

        if (loadSparks && !sparksLoaded) {
          sparksLoaded = true
          await Promise.allSettled(
            nextAssets.map(async (asset) => {
              const { bars } = await fetchBars(asset, '1D', { signal: ctrl.signal })
              if (!bars.length) return
              const spark = sample(bars.map((b) => b.c), SPARK_POINTS)
              setQuotes((prev) => {
                const q = prev[asset.symbol]
                return q ? { ...prev, [asset.symbol]: { ...q, spark: [...spark.slice(0, -1), q.price] } } : prev
              })
            }),
          )
        }
      } catch (err) {
        if (err.name === 'AbortError') return
        // Keep showing the last good data if a refresh fails.
        setStatus((prev) => ({ ...prev, status: prev.status === 'ready' ? 'ready' : 'error', error: err.message }))
      }
    }

    load()
    const id = setInterval(load, SNAPSHOT_REFRESH_MS)
    return () => {
      ctrl.abort()
      clearInterval(id)
    }
  }, [fetchList, toAsset, loadSparks, setQuotes, reloadKey])

  const retry = useCallback(() => {
    setStatus((prev) => ({ ...prev, status: 'loading', error: null }))
    setReloadKey((k) => k + 1)
  }, [])

  return { assets, status, retry }
}

// Real-time prices over the back end's WebSocket, reconnecting with backoff.
// The back end routes stock symbols and crypto pairs to Alpaca, currency pairs to Finnhub.
function useLiveStream(symbols, setQuotes) {
  const [streams, setStreams] = useState({})
  const symbolKey = symbols.join(',')

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
        else if (msg.type === 'status') {
          setStreams((prev) => ({ ...prev, [msg.provider ?? 'alpaca']: { state: msg.state, message: msg.message, feed: msg.feed } }))
        } else if (msg.type === 'bar') {
          setQuotes((prev) => {
            const q = prev[msg.symbol]
            return q ? { ...prev, [msg.symbol]: { ...q, spark: [...q.spark.slice(1, -1), msg.bar.c, q.price] } } : prev
          })
        } else if (msg.type === 'error') console.warn('Live stream:', msg.message)
      }
      ws.onclose = () => {
        if (closed) return
        const delay = Math.min(30e3, 1000 * 2 ** retry++)
        const down = { state: 'reconnecting', message: `Can't reach the live stream, retrying in ${Math.round(delay / 1000)}s` }
        setStreams(Object.fromEntries(STREAM_PROVIDERS.map((p) => [p, down])))
        timer = setTimeout(connect, delay)
      }
    }

    connect()
    return () => {
      closed = true
      clearTimeout(timer)
      ws?.close()
    }
  }, [symbolKey, setQuotes])

  return streams
}

// Live stocks and crypto (Alpaca) and currencies (Twelve Data + Finnhub).
export function useMarket() {
  const [quotes, setQuotes] = useState({})
  const stocks = useLiveSource('stock', setQuotes)
  const forex = useLiveSource('forex', setQuotes)
  const crypto = useLiveSource('crypto', setQuotes)

  const assets = useMemo(() => [...stocks.assets, ...forex.assets, ...crypto.assets], [stocks.assets, forex.assets, crypto.assets])
  const liveSymbols = useMemo(() => assets.map((a) => a.symbol), [assets])
  const streams = useLiveStream(liveSymbols, setQuotes)

  const bySymbol = useMemo(() => Object.fromEntries(assets.map((a) => [a.symbol, a])), [assets])
  const sources = {
    stock: { ...stocks.status, retry: stocks.retry },
    forex: { ...forex.status, retry: forex.retry },
    crypto: { ...crypto.status, retry: crypto.retry },
  }

  return { assets, bySymbol, quotes, sources, streams }
}

// Candles for a chart, fetched from the API.
export function useCandles(asset, range) {
  const key = `${asset.symbol}:${range}`
  const [state, setState] = useState({ key: null, candles: null, error: null })
  // The asset object is rebuilt on every snapshot refresh; symbol + type identify it.
  const { symbol, type } = asset

  useEffect(() => {
    const ctrl = new AbortController()
    const load = () =>
      fetchBars({ symbol, type }, range, { signal: ctrl.signal })
        .then((data) => setState({ key, candles: data.bars, error: null }))
        .catch((err) => err.name !== 'AbortError' && setState((prev) => ({ ...prev, key, error: err.message })))
    load()
    // Intraday charts pick up new candles while open (the back end caches, so this is cheap).
    const id = range === '1D' ? setInterval(load, 60e3) : null
    return () => {
      ctrl.abort()
      clearInterval(id)
    }
  }, [symbol, type, range, key])

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
const DEFAULT_WATCHLIST = ['NVDA', 'BTC/USD', 'EUR/USD']
const LEGACY_CRYPTO = ['BTC', 'ETH', 'SOL', 'XRP', 'BNB', 'ADA']

export function useWatchlist() {
  const [list, setList] = useState(() => {
    try {
      const saved = JSON.parse(localStorage.getItem(WATCH_KEY))
      // Crypto used to be keyed "BTC"; it's now the Alpaca pair "BTC/USD".
      return saved ? saved.map((s) => (LEGACY_CRYPTO.includes(s) ? `${s}/USD` : s)) : DEFAULT_WATCHLIST
    } catch {
      return DEFAULT_WATCHLIST
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
