import { HttpError } from '../middlewares/errorHandler.js'
import { RANGES, getAssetInfo, getBars, getClock, getSnapshots } from '../services/alpaca.js'

// Default watch list returned when the client doesn't pass ?symbols=.
export const DEFAULT_STOCKS = ['AAPL', 'MSFT', 'NVDA', 'GOOGL', 'AMZN', 'TSLA', 'META', 'JPM', 'NFLX']
const MAX_SYMBOLS = 50
const SYMBOL_RE = /^[A-Z][A-Z0-9.]{0,9}$/

export function parseSymbol(value) {
  const symbol = String(value).trim().toUpperCase()
  if (!SYMBOL_RE.test(symbol)) throw new HttpError(400, `Invalid symbol: ${value}`)
  return symbol
}

// GET /api/livedata/stocks?symbols=AAPL,MSFT
export async function getStocks(req, res) {
  const symbols = req.query.symbols
    ? [...new Set(String(req.query.symbols).split(',').filter(Boolean).map(parseSymbol))]
    : DEFAULT_STOCKS
  if (symbols.length > MAX_SYMBOLS) throw new HttpError(400, `At most ${MAX_SYMBOLS} symbols per request`)

  // Names and the market clock are nice-to-have: a failure there must not hide the prices.
  const [{ quotes, missing }, infos, market] = await Promise.all([
    getSnapshots(symbols),
    Promise.all(symbols.map((s) => getAssetInfo(s).catch(() => ({ name: s, exchange: null })))),
    getClock().catch(() => null),
  ])
  const infoBySymbol = Object.fromEntries(symbols.map((s, i) => [s, infos[i]]))

  res.json({
    source: 'alpaca',
    feed: process.env.ALPACA_FEED || 'iex',
    fetchedAt: new Date().toISOString(),
    market,
    quotes: quotes.map((q) => ({ ...q, ...infoBySymbol[q.symbol] })),
    missing,
  })
}

// GET /api/livedata/stocks/:symbol/bars?range=1D|1W|1M|1Y|5Y
export async function getStockBars(req, res) {
  const symbol = parseSymbol(req.params.symbol)
  const range = String(req.query.range || '1D').toUpperCase()
  if (!RANGES[range]) throw new HttpError(400, `Invalid range: ${range}. Use one of ${Object.keys(RANGES).join(', ')}`)

  res.json(await getBars(symbol, range))
}
