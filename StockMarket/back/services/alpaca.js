// Thin client for the Alpaca Market Data API v2 and the Trading API (https://docs.alpaca.markets/reference).
import { HttpError } from '../middlewares/errorHandler.js'

// Chart ranges → Alpaca bar timeframe + how far back to fetch.
export const RANGES = {
  '1D': { timeframe: '5Min', lookbackDays: 5, lastSessionOnly: true, cacheMs: 30e3 },
  '1W': { timeframe: '1Hour', lookbackDays: 7, cacheMs: 5 * 60e3 },
  '1M': { timeframe: '4Hour', lookbackDays: 31, cacheMs: 5 * 60e3 },
  '1Y': { timeframe: '1Day', lookbackDays: 366, cacheMs: 30 * 60e3 },
  '5Y': { timeframe: '1Week', lookbackDays: 5 * 366, cacheMs: 60 * 60e3 },
}

const SNAPSHOT_CACHE_MS = 5e3
const ASSET_CACHE_MS = 24 * 3600e3
const CLOCK_CACHE_MS = 30e3
const MAX_PAGES = 5
const DAY_MS = 864e5

function credentials() {
  const keyId = process.env.ALPACA_KEY_ID
  const secretKey = process.env.ALPACA_SECRET_KEY
  if (!keyId || !secretKey) throw new HttpError(503, 'Alpaca API keys are not configured on the server')
  return { keyId, secretKey }
}

// Market data API: prices, snapshots, bars.
function alpacaGet(path, params = {}) {
  const url = new URL(path, process.env.ALPACA_DATA_URL || 'https://data.alpaca.markets')
  for (const [key, value] of Object.entries({ feed: process.env.ALPACA_FEED || 'iex', ...params })) {
    if (value != null) url.searchParams.set(key, value)
  }
  return request(url)
}

// Trading API: asset details, market clock. ALPACA_API_URL may be given with or without the /v2 suffix.
function tradingGet(path) {
  const base = (process.env.ALPACA_API_URL || 'https://paper-api.alpaca.markets/v2').replace(/\/+$/, '').replace(/\/v2$/, '')
  return request(new URL(`${base}/v2${path}`))
}

async function request(url) {
  const { keyId, secretKey } = credentials()
  let res
  try {
    res = await fetch(url, {
      headers: { 'APCA-API-KEY-ID': keyId, 'APCA-API-SECRET-KEY': secretKey, Accept: 'application/json' },
      signal: AbortSignal.timeout(10e3),
    })
  } catch (err) {
    if (err.name === 'TimeoutError') throw new HttpError(504, 'Alpaca did not respond in time')
    throw new HttpError(502, `Could not reach Alpaca: ${err.message}`)
  }

  if (!res.ok) {
    const detail = (await res.text()).slice(0, 300)
    if (res.status === 401 || res.status === 403) throw new HttpError(502, 'Alpaca rejected the API keys or feed for this plan')
    if (res.status === 429) throw new HttpError(429, 'Alpaca rate limit reached, try again shortly')
    if (res.status < 500) throw new HttpError(400, `Alpaca: ${detail}`)
    throw new HttpError(502, `Alpaca error ${res.status}`)
  }
  return res.json()
}

// Short-lived in-memory cache so many browser tabs don't burn through the rate limit.
const cache = new Map()
function cached(key, ttlMs, load) {
  const hit = cache.get(key)
  if (hit && hit.expires > Date.now()) return hit.promise
  const promise = load().catch((err) => {
    cache.delete(key)
    throw err
  })
  cache.set(key, { promise, expires: Date.now() + ttlMs })
  return promise
}

const round = (value, dp) => (value == null ? null : Number(value.toFixed(dp)))

// Outside market hours IEX often leaves placeholder quotes (0, 0.01); drop anything
// that is non-positive or more than 2% away from the last trade.
function saneQuote(value, price) {
  if (!value || value <= 0 || price == null) return null
  return Math.abs(value / price - 1) <= 0.02 ? value : null
}

function normalizeSnapshot(symbol, snap) {
  const price = snap.latestTrade?.p ?? snap.minuteBar?.c ?? snap.dailyBar?.c ?? null
  const prevClose = snap.prevDailyBar?.c ?? null
  const change = price != null && prevClose ? round(price - prevClose, 4) : null
  return {
    symbol,
    price,
    open: snap.dailyBar?.o ?? null,
    high: snap.dailyBar?.h ?? null,
    low: snap.dailyBar?.l ?? null,
    volume: snap.dailyBar?.v ?? null,
    prevClose,
    change,
    changePct: change != null ? round(change / prevClose, 6) : null,
    bid: saneQuote(snap.latestQuote?.bp, price),
    ask: saneQuote(snap.latestQuote?.ap, price),
    updatedAt: snap.latestTrade?.t ?? snap.minuteBar?.t ?? null,
  }
}

export function getSnapshots(symbols) {
  const key = `snap:${symbols.join(',')}`
  return cached(key, SNAPSHOT_CACHE_MS, async () => {
    const data = await alpacaGet('/v2/stocks/snapshots', { symbols: symbols.join(',') })
    const quotes = []
    const missing = []
    for (const symbol of symbols) {
      if (data[symbol]) quotes.push(normalizeSnapshot(symbol, data[symbol]))
      else missing.push(symbol)
    }
    return { quotes, missing }
  })
}

// "Apple Inc. Common Stock" → "Apple Inc."
const cleanName = (name) => name.replace(/\s+(Common Stock|Ordinary Shares|American Depositary Shares.*|Capital Stock)$/i, '').trim()

// Company name + listing exchange, from the trading API's asset master. Cached for a day.
export function getAssetInfo(symbol) {
  return cached(`asset:${symbol}`, ASSET_CACHE_MS, async () => {
    const asset = await tradingGet(`/assets/${encodeURIComponent(symbol)}`)
    return { name: cleanName(asset.name || symbol), exchange: asset.exchange || null }
  })
}

// Whether the US market is open right now, and the next open/close times.
export function getClock() {
  return cached('clock', CLOCK_CACHE_MS, async () => {
    const clock = await tradingGet('/clock')
    return { isOpen: clock.is_open, nextOpen: clock.next_open, nextClose: clock.next_close }
  })
}

const nyDate =(t) => new Date(t).toLocaleDateString('en-CA', { timeZone: 'America/New_York' })

export function getBars(symbol, range) {
  const { timeframe, lookbackDays, lastSessionOnly, cacheMs } = RANGES[range]
  return cached(`bars:${symbol}:${range}`, cacheMs, async () => {
    const params = {
      timeframe,
      start: new Date(Date.now() - lookbackDays * DAY_MS).toISOString(),
      limit: 10000,
      adjustment: 'split',
      sort: 'asc',
    }
    const raw = []
    let pageToken
    let pages = 0
    do {
      const data = await alpacaGet(`/v2/stocks/${encodeURIComponent(symbol)}/bars`, { ...params, page_token: pageToken })
      raw.push(...(data.bars ?? []))
      pageToken = data.next_page_token
    } while (pageToken && ++pages < MAX_PAGES)

    let bars = raw.map((b) => ({ t: Date.parse(b.t), o: b.o, h: b.h, l: b.l, c: b.c, v: b.v }))
    // 1D shows only the most recent trading session (handles weekends and holidays).
    if (lastSessionOnly && bars.length) {
      const lastDay = nyDate(bars[bars.length - 1].t)
      bars = bars.filter((b) => nyDate(b.t) === lastDay)
    }
    return { symbol, range, timeframe, bars }
  })
}
