import { Router } from 'express'
import { getStockBars, getStocks } from '../controllers/liveDataController.js'

const router = Router()

router.get('/stocks', getStocks)
router.get('/stocks/:symbol/bars', getStockBars)

export default router
