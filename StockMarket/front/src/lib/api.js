// Backend base URL. Override with VITE_API_URL in front/.env.local.
export const API_URL = (import.meta.env.VITE_API_URL || 'http://localhost:4000').replace(/\/+$/, '')
export const STREAM_URL = `${API_URL.replace(/^http/, 'ws')}/api/livedata/stream`

export async function getJSON(path, { signal } = {}) {
  let res
  try {
    res = await fetch(API_URL + path, { signal })
  } catch (err) {
    if (err.name === 'AbortError') throw err
    throw new Error(`Can't reach the API at ${API_URL} — is the back end running?`)
  }
  const body = await res.json().catch(() => ({}))
  if (!res.ok) throw new Error(body.error || `Request failed (${res.status})`)
  return body
}

export const fetchStocks = (opts) => getJSON('/api/livedata/stocks', opts)
export const fetchForex = (opts) => getJSON('/api/livedata/forex', opts)

// Chart candles for a live asset: "AAPL" → /stocks/AAPL/bars, "EUR/USD" → /forex/EURUSD/bars
export function fetchBars(asset, range, opts) {
  const path = asset.type === 'forex' ? `forex/${asset.symbol.replace('/', '')}` : `stocks/${encodeURIComponent(asset.symbol)}`
  return getJSON(`/api/livedata/${path}/bars?range=${range}`, opts)
}
