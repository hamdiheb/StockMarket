// Twelve Data client for forex history (https://twelvedata.com/docs).
// Free plan: 8 credits/minute, 800/day, 1 credit per symbol — so everything is cached
// and a local limiter queues requests instead of letting Twelve Data reject them.
import { HttpError } from '../middlewares/errorHandler.js'
import { cached, peek, prime } from './cache.js'

const BASE_URL = 'https://api.twelvedata.com'
const CREDITS_PER_MIN = Number(process.env.TWELVEDATA_CREDITS_PER_MIN) || 8
const MAX_QUEUE_WAIT_MS = 25e3
const SPARK_POINTS = 48

// Same range keys as the stock charts. Twelve Data includes weekend bars for forex,
// so outputsize is calendar time: 24h of 5-min bars, 7 days of hourly, and so on.
export const FX_RANGES = {
  '1D': { interval: '5min', outputsize: 288, cacheMs: 15 * 60e3 },
  '1W': { interval: '1h', outputsize: 168, cacheMs: 30 * 60e3 },
  '1M': { interval: '4h', outputsize: 186, cacheMs: 60 * 60e3 },
  '1Y': { interval: '1day', outputsize: 365, cacheMs: 6 * 3600e3 },
  '5Y': { interval: '1week', outputsize: 261, cacheMs: 24 * 3600e3 },
}

// ---- rate limiter: rolling 60s window of spent credits, served in FIFO order ----
const spent = []
let queue = Promise.resolve()

function acquire(credits) {
  const turn = queue.then(async () => {
    const deadline = Date.now() + MAX_QUEUE_WAIT_MS
    for (;;) {
      const now = Date.now()
      while (spent.length && now - spent[0] >= 60e3) spent.shift()
      if (spent.length + credits <= CREDITS_PER_MIN) {
        for (let i = 0; i < credits; i++) spent.push(now)
        return
      }
      const waitMs = spent[spent.length + credits - CREDITS_PER_MIN - 1] + 60e3 - now
      if (now + waitMs > deadline) {
        throw new HttpError(429, `Twelve Data free limit reached (${CREDITS_PER_MIN}/min), try again in ${Math.ceil(waitMs / 1000)}s`)
      }
      await new Promise((resolve) => setTimeout(resolve, waitMs + 50))
    }
  })
  queue = turn.catch(() => {})
  return turn
}

function apiError(code, message) {
  if (code === 401 || code === 403) return new HttpError(502, 'Twelve Data rejected the API key or this symbol is not in your plan')
  if (code === 429) return new HttpError(429, 'Twelve Data limit reached (8 requests/min, 800/day on the free plan)')
  if (code >= 400 && code < 500) return new HttpError(400, `Twelve Data: ${message}`)
  return new HttpError(502, `Twelve Data error ${code}`)
}

async function tdGet(path, params, credits) {
  const apikey = process.env.TWELVEDATA_API_KEY
  if (!apikey) throw new HttpError(503, 'Twelve Data API key is not configured on the server')
  await acquire(credits)

  const url = new URL(path, BASE_URL)
  for (const [key, value] of Object.entries({ ...params, apikey })) url.searchParams.set(key, value)
  let res
  try {
    res = await fetch(url, { signal: AbortSignal.timeout(15e3) })
  } catch (err) {
    if (err.name === 'TimeoutError') throw new HttpError(504, 'Twelve Data did not respond in time')
    throw new HttpError(502, `Could not reach Twelve Data: ${err.message}`)
  }
  const body = await res.json().catch(() => ({}))
  // Twelve Data reports most errors inside an HTTP 200 body.
  if (!res.ok || body.status === 'error') throw apiError(body.code ?? res.status, body.message)
  return body
}

// "2026-10-15 10:35:00" / "2026-10-12" (requested in UTC) → epoch ms
const parseTime = (dt) => Date.parse(dt.length === 10 ? `${dt}T00:00:00Z` : `${dt.replace(' ', 'T')}Z`)

function parseSeries(series) {
  if (series.status === 'error') throw apiError(series.code, series.message)
  const bars = (series.values ?? [])
    .map((v) => ({ t: parseTime(v.datetime), o: +v.open, h: +v.high, l: +v.low, c: +v.close, v: v.volume ? +v.volume : 0 }))
    .sort((a, b) => a.t - b.t)
  return { bars, base: series.meta?.currency_base, quote: series.meta?.currency_quote }
}

const seriesParams = (range) => {
  const { interval, outputsize } = FX_RANGES[range]
  return { interval, outputsize, timezone: 'UTC' }
}

export function getForexBars(pair, range) {
  return cached(`fx:${pair}:${range}`, FX_RANGES[range].cacheMs, async () => {
    const { bars } = parseSeries(await tdGet('/time_series', { symbol: pair, ...seriesParams(range) }, 1))
    return { symbol: pair, range, timeframe: FX_RANGES[range].interval, bars }
  })
}

function sample(values, n) {
  if (values.length <= n) return values
  return Array.from({ length: n }, (_, i) => values[Math.round((i / (n - 1)) * (values.length - 1))])
}

// Rolling-24h snapshot built from the 1D bars, so a page load costs one credit per pair
// and the 1D chart is then served from the same cache.
function snapshot(pair, { bars, base, quote }) {
  if (!bars.length) return null
  const first = bars[0]
  const last = bars[bars.length - 1]
  const change = last.c - first.o
  return {
    symbol: pair,
    name: base && quote ? `${base} / ${quote}` : pair,
    price: last.c,
    open: first.o,
    high: Math.max(...bars.map((b) => b.h)),
    low: Math.min(...bars.map((b) => b.l)),
    prevClose: first.o,
    change: Number(change.toFixed(6)),
    changePct: Number((change / first.o).toFixed(6)),
    volume: null,
    spark: sample(bars.map((b) => b.c), SPARK_POINTS),
    updatedAt: new Date(last.t).toISOString(),
  }
}

export async function getForexSnapshots(pairs) {
  const { cacheMs } = FX_RANGES['1D']
  const missing = pairs.filter((p) => !peek(`fx:${p}:1D:raw`))
  if (missing.length) {
    // One batched request for every pair not yet cached.
    const batch = tdGet('/time_series', { symbol: missing.join(','), ...seriesParams('1D') }, missing.length)
    for (const pair of missing) {
      // A single-symbol request returns the series itself; a batch is keyed by symbol.
      const raw = batch.then((body) => {
        const series = missing.length === 1 ? body : body[pair]
        if (!series) throw new HttpError(400, `Twelve Data returned nothing for ${pair}`)
        return parseSeries(series)
      })
      prime(`fx:${pair}:1D:raw`, cacheMs, raw)
      prime(`fx:${pair}:1D`, cacheMs, raw.then(({ bars }) => ({ symbol: pair, range: '1D', timeframe: '5min', bars })))
    }
  }

  const results = await Promise.allSettled(pairs.map((p) => peek(`fx:${p}:1D:raw`)))
  const quotes = []
  const failed = []
  results.forEach((r, i) => {
    const snap = r.status === 'fulfilled' ? snapshot(pairs[i], r.value) : null
    if (snap) quotes.push(snap)
    else failed.push({ symbol: pairs[i], error: r.reason?.message ?? 'No data' })
  })
  // If nothing worked, surface the real reason (bad key, rate limit…) instead of an empty list.
  if (!quotes.length && failed.length) throw results.find((r) => r.status === 'rejected')?.reason ?? new HttpError(502, 'No forex data')
  return { quotes, missing: failed }
}
