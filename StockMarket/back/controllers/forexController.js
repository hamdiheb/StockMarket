import { HttpError } from '../middlewares/errorHandler.js'
import { FX_RANGES, getForexBars, getForexSnapshots } from '../services/twelveData.js'

// Default pairs returned when the client doesn't pass ?pairs=.
export const DEFAULT_FOREX = ['EUR/USD', 'GBP/USD', 'USD/JPY', 'USD/CHF', 'AUD/USD', 'EUR/TND']
const MAX_PAIRS = 8 // one batch must fit in the free plan's 8 credits/minute
export const PAIR_RE = /^[A-Z]{3}\/[A-Z]{3}$/

// Accepts "EUR/USD", "EUR-USD", "EUR_USD" or "EURUSD".
export function parsePair(value) {
  let pair = String(value).trim().toUpperCase().replace(/[-_]/, '/')
  if (/^[A-Z]{6}$/.test(pair)) pair = `${pair.slice(0, 3)}/${pair.slice(3)}`
  if (!PAIR_RE.test(pair)) throw new HttpError(400, `Invalid currency pair: ${value}`)
  return pair
}

// GET /api/livedata/forex?pairs=EUR/USD,GBP/USD
export async function getForex(req, res) {
  const pairs = req.query.pairs
    ? [...new Set(String(req.query.pairs).split(',').filter(Boolean).map(parsePair))]
    : DEFAULT_FOREX
  if (pairs.length > MAX_PAIRS) throw new HttpError(400, `At most ${MAX_PAIRS} pairs per request`)

  const { quotes, missing } = await getForexSnapshots(pairs)
  res.json({ source: 'twelvedata', live: 'finnhub', window: '24h', fetchedAt: new Date().toISOString(), quotes, missing })
}

// GET /api/livedata/forex/:pair/bars?range=1D|1W|1M|1Y|5Y   (pair as EURUSD or EUR-USD)
export async function getForexPairBars(req, res) {
  const pair = parsePair(req.params.pair)
  const range = String(req.query.range || '1D').toUpperCase()
  if (!FX_RANGES[range]) throw new HttpError(400, `Invalid range: ${range}. Use one of ${Object.keys(FX_RANGES).join(', ')}`)

  res.json(await getForexBars(pair, range))
}
