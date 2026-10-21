import { HttpError } from '../middlewares/errorHandler.js'
import { CRYPTO_RANGES, getCryptoAssets, getCryptoBars, getCryptoSnapshots } from '../services/alpaca.js'

// Default pairs returned when the client doesn't pass ?symbols=.
export const DEFAULT_CRYPTO = ['BTC/USD', 'ETH/USD', 'SOL/USD', 'XRP/USD', 'DOGE/USD', 'ADA/USD', 'LTC/USD', 'LINK/USD', 'AVAX/USD']
const MAX_SYMBOLS = 50
export const CRYPTO_RE = /^[A-Z0-9]{2,10}\/[A-Z]{3,4}$/

// Accepts "BTC/USD", "BTC-USD", "BTC_USD" or "BTC" (priced in USD).
export function parseCryptoPair(value) {
  let pair = String(value).trim().toUpperCase().replace(/[-_]/, '/')
  if (!pair.includes('/')) pair = `${pair}/USD`
  if (!CRYPTO_RE.test(pair)) throw new HttpError(400, `Invalid crypto pair: ${value}`)
  return pair
}

// GET /api/livedata/crypto?symbols=BTC/USD,ETH/USD
export async function getCrypto(req, res) {
  const symbols = req.query.symbols
    ? [...new Set(String(req.query.symbols).split(',').filter(Boolean).map(parseCryptoPair))]
    : DEFAULT_CRYPTO
  if (symbols.length > MAX_SYMBOLS) throw new HttpError(400, `At most ${MAX_SYMBOLS} symbols per request`)

  // Names are nice-to-have: a failure there must not hide the prices.
  const [{ quotes, missing }, names] = await Promise.all([getCryptoSnapshots(symbols), getCryptoAssets().catch(() => ({}))])

  res.json({
    source: 'alpaca',
    feed: 'us',
    fetchedAt: new Date().toISOString(),
    quotes: quotes.map((q) => ({ ...q, name: names[q.symbol] ?? q.symbol.split('/')[0] })),
    missing,
  })
}

// GET /api/livedata/crypto/:pair/bars?range=1D|1W|1M|1Y|5Y   (pair as BTC-USD)
export async function getCryptoPairBars(req, res) {
  const symbol = parseCryptoPair(req.params.pair)
  const range = String(req.query.range || '1D').toUpperCase()
  if (!CRYPTO_RANGES[range]) throw new HttpError(400, `Invalid range: ${range}. Use one of ${Object.keys(CRYPTO_RANGES).join(', ')}`)

  res.json(await getCryptoBars(symbol, range))
}
