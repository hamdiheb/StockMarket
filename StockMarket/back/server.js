import 'dotenv/config'
import cors from 'cors'
import express from 'express'
import { STREAM_PATH, attachLiveStream } from './controllers/streamController.js'
import { errorHandler, notFound } from './middlewares/errorHandler.js'
import { requestLogger } from './middlewares/requestLogger.js'
import liveDataRoutes from './routes/liveData.js'
import { alpacaStream } from './services/alpacaStream.js'

const app = express()
const PORT = Number(process.env.PORT) || 4000
const origins = (process.env.CORS_ORIGIN || 'http://localhost:5173').split(',').map((o) => o.trim())

app.use(cors({ origin: origins }))
app.use(express.json())
app.use(requestLogger)

app.get('/api/health', (_req, res) =>
  res.json({ status: 'ok', stream: { state: alpacaStream.state, message: alpacaStream.message, symbols: alpacaStream.symbols } }),
)
app.use('/api/livedata', liveDataRoutes)

app.use(notFound)
app.use(errorHandler)

const server = app.listen(PORT, () => {
  console.log(`API listening on http://localhost:${PORT}`)
  console.log(`Live stream on ws://localhost:${PORT}${STREAM_PATH}`)
  if (!process.env.ALPACA_KEY_ID || !process.env.ALPACA_SECRET_KEY) {
    console.warn('ALPACA_KEY_ID / ALPACA_SECRET_KEY are not set — live data endpoints will not work')
  }
})
attachLiveStream(server, origins)
alpacaStream.on('status', ({ state, message }) => console.log(`Alpaca stream: ${state}${message ? ` — ${message}` : ''}`))

// Close the Alpaca socket on exit so a restart (e.g. `node --watch`) doesn't hit the 1-connection limit.
for (const signal of ['SIGINT', 'SIGTERM']) {
  process.on(signal, () => {
    alpacaStream.close()
    server.close(() => process.exit(0))
    setTimeout(() => process.exit(0), 1000).unref()
  })
}
