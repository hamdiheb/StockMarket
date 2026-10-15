import { HttpError } from '../middlewares/errorHandler.js'
import { RANGES, getBars, getSnapshots } from '../services/alpaca.js'

// Same tickers the front end lists under "Stocks".
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

  const { quotes, missing } = await getSnapshots(symbols)
  res.json({ source: 'alpaca', feed: process.env.ALPACA_FEED || 'iex', fetchedAt: new Date().toISOString(), quotes, missing })
}

// GET /api/livedata/stocks/:symbol/bars?range=1D|1W|1M|1Y|5Y
export async function getStockBars(req, res) {
  const symbol = parseSymbol(req.params.symbol)
  const range = String(req.query.range || '1D').toUpperCase()
  if (!RANGES[range]) throw new HttpError(400, `Invalid range: ${range}. Use one of ${Object.keys(RANGES).join(', ')}`)

  res.json(await getBars(symbol, range))
}
