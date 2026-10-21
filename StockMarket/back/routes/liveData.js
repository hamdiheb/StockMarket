import { Router } from 'express'
import { getCrypto, getCryptoPairBars } from '../controllers/cryptoController.js'
import { getForex, getForexPairBars } from '../controllers/forexController.js'
import { getStockBars, getStocks } from '../controllers/liveDataController.js'

const router = Router()

router.get('/stocks', getStocks)
router.get('/stocks/:symbol/bars', getStockBars)

router.get('/forex', getForex)
router.get('/forex/:pair/bars', getForexPairBars)

router.get('/crypto', getCrypto)
router.get('/crypto/:pair/bars', getCryptoPairBars)

export default router
