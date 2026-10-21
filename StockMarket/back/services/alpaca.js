// Thin client for the Alpaca Market Data API v2 and the Trading API (https://docs.alpaca.markets/reference).
import { HttpError } from '../middlewares/errorHandler.js'
// Short-lived cache so many browser tabs don't burn through the rate limit.
import { cached } from './cache.js'

// Chart ranges → Alpaca bar timeframe + how far back to fetch.
export const RANGES = {
  '1D': { timeframe: '5Min', lookbackDays: 5, lastSessionOnly: true, cacheMs: 30e3 },
  '1W': { timeframe: '1Hour', lookbackDays: 7, cacheMs: 5 * 60e3 },
  '1M': { timeframe: '4Hour', lookbackDays: 31, cacheMs: 5 * 60e3 },
  '1Y': { timeframe: '1Day', lookbackDays: 366, cacheMs: 30 * 60e3 },
  '5Y': { timeframe: '1Week', lookbackDays: 5 * 366, cacheMs: 60 * 60e3 },
}

// Crypto trades around the clock, so 1D is simply the last 24 hours.
export const CRYPTO_RANGES = {
  '1D': { timeframe: '5Min', lookbackDays: 1, cacheMs: 30e3 },
  '1W': RANGES['1W'],
  '1M': RANGES['1M'],
  '1Y': RANGES['1Y'],
  '5Y': RANGES['5Y'],
}

const SNAPSHOT_CACHE_MS = 5e3
const ASSET_CACHE_MS = 24 * 3600e3
const CLOCK_CACHE_MS = 30e3
const MAX_PAGES = 5
const DAY_MS = 864e5
// Alpaca's crypto data location ("us" = Alpaca's own US exchange).
const CRYPTO_LOC = 'us'

function credentials() {
  const keyId = process.env.ALPACA_KEY_ID
  const secretKey = process.env.ALPACA_SECRET_KEY
  if (!keyId || !secretKey) throw new HttpError(503, 'Alpaca API keys are not configured on the server')
  return { keyId, secretKey }
}

// Market data API: prices, snapshots, bars.
function dataGet(path, params = {}) {
  const url = new URL(path, process.env.ALPACA_DATA_URL || 'https://data.alpaca.markets')
  for (const [key, value] of Object.entries(params)) {
    if (value != null) url.searchParams.set(key, value)
  }
  return request(url)
}

const alpacaGet = (path, params = {}) => dataGet(path, { feed: process.env.ALPACA_FEED || 'iex', ...params })
// Crypto has no feed parameter; symbols are pairs like "BTC/USD".
const cryptoGet = (path, params = {}) => dataGet(`/v1beta3/crypto/${CRYPTO_LOC}${path}`, params)

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

// Follows next_page_token; fetchPage(pageToken) returns { bars: [...], next_page_token }.
async function pagedBars(fetchPage) {
  const raw = []
  let pageToken
  let pages = 0
  do {
    const data = await fetchPage(pageToken)
    raw.push(...(data.bars ?? []))
    pageToken = data.next_page_token
  } while (pageToken && ++pages < MAX_PAGES)
  return raw.map((b) => ({ t: Date.parse(b.t), o: b.o, h: b.h, l: b.l, c: b.c, v: b.v }))
}

const barParams = (timeframe, lookbackDays) => ({
  timeframe,
  start: new Date(Date.now() - lookbackDays * DAY_MS).toISOString(),
  limit: 10000,
  sort: 'asc',
})

export function getBars(symbol, range) {
  const { timeframe, lookbackDays, lastSessionOnly, cacheMs } = RANGES[range]
  return cached(`bars:${symbol}:${range}`, cacheMs, async () => {
    const params = { ...barParams(timeframe, lookbackDays), adjustment: 'split' }
    let bars = await pagedBars((pageToken) =>
      alpacaGet(`/v2/stocks/${encodeURIComponent(symbol)}/bars`, { ...params, page_token: pageToken }),
    )
    // 1D shows only the most recent trading session (handles weekends and holidays).
    if (lastSessionOnly && bars.length) {
      const lastDay = nyDate(bars[bars.length - 1].t)
      bars = bars.filter((b) => nyDate(b.t) === lastDay)
    }
    return { symbol, range, timeframe, bars }
  })
}

// ---- Crypto (https://docs.alpaca.markets/reference/cryptosnapshots-1) ----

export function getCryptoSnapshots(symbols) {
  const key = `crypto-snap:${symbols.join(',')}`
  return cached(key, SNAPSHOT_CACHE_MS, async () => {
    const { snapshots = {} } = await cryptoGet('/snapshots', { symbols: symbols.join(',') })
    const quotes = []
    const missing = []
    for (const symbol of symbols) {
      if (snapshots[symbol]) quotes.push(normalizeSnapshot(symbol, snapshots[symbol]))
      else missing.push(symbol)
    }
    return { quotes, missing }
  })
}

// Every crypto pair Alpaca lists, as { "BTC/USD": "Bitcoin" }. Cached for a day.
export function getCryptoAssets() {
  return cached('crypto-assets', ASSET_CACHE_MS, async () => {
    const assets = await tradingGet('/assets?asset_class=crypto&status=active')
    // "Bitcoin  / US Dollar" → "Bitcoin"
    return Object.fromEntries(assets.map((a) => [a.symbol, (a.name || a.symbol).split(' / ')[0].trim()]))
  })
}

export function getCryptoBars(symbol, range) {
  const { timeframe, lookbackDays, cacheMs } = CRYPTO_RANGES[range]
  return cached(`crypto-bars:${symbol}:${range}`, cacheMs, async () => {
    const params = { ...barParams(timeframe, lookbackDays), symbols: symbol }
    // The crypto endpoint is multi-symbol: bars come back keyed by pair.
    const bars = await pagedBars(async (pageToken) => {
      const data = await cryptoGet('/bars', { ...params, page_token: pageToken })
      return { bars: data.bars?.[symbol], next_page_token: data.next_page_token }
    })
    return { symbol, range, timeframe, bars }
  })
}
