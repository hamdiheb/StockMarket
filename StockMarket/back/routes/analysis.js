import { Router } from 'express'
import { getAnalysis } from '../controllers/analysisController.js'

const router = Router()

router.get('/:type/:symbol', getAnalysis)

export default router
