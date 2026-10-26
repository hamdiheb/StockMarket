import { HttpError } from '../middlewares/errorHandler.js'
import { analyze } from '../services/analysis.js'
import { parseCryptoPair } from './cryptoController.js'
import { parsePair } from './forexController.js'
import { parseSymbol } from './liveDataController.js'

const PARSERS = { stock: parseSymbol, forex: parsePair, crypto: parseCryptoPair }

// GET /api/analysis/:type/:symbol?refresh=1   (type = stock | forex | crypto; pairs as EURUSD / BTC-USD)
// refresh=1 skips the cache and asks the model again (manual re-analyze).
export async function getAnalysis(req, res) {
  const parse = PARSERS[req.params.type]
  if (!parse) throw new HttpError(400, `Invalid type: ${req.params.type}. Use one of ${Object.keys(PARSERS).join(', ')}`)

  res.json(await analyze(req.params.type, parse(req.params.symbol), { refresh: req.query.refresh === '1' }))
}
