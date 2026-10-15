import { Router } from 'express'
import { getForex, getForexPairBars } from '../controllers/forexController.js'
import { getStockBars, getStocks } from '../controllers/liveDataController.js'

const router = Router()

router.get('/stocks', getStocks)
router.get('/stocks/:symbol/bars', getStockBars)

router.get('/forex', getForex)
router.get('/forex/:pair/bars', getForexPairBars)

export default router
