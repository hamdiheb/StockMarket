import 'dotenv/config'
import cors from 'cors'
import express from 'express'
import { STREAM_PATH, UPSTREAMS, attachLiveStream } from './controllers/streamController.js'
import { errorHandler, notFound } from './middlewares/errorHandler.js'
import { requestLogger } from './middlewares/requestLogger.js'
import analysisRoutes from './routes/analysis.js'
import liveDataRoutes from './routes/liveData.js'
import { checkOllama, ollamaUrl } from './services/ollama.js'

const app = express()
const PORT = Number(process.env.PORT) || 4000
const origins = (process.env.CORS_ORIGIN || 'http://localhost:5173').split(',').map((o) => o.trim())

app.use(cors({ origin: origins }))
app.use(express.json())
app.use(requestLogger)

app.get('/api/health', (_req, res) =>
  res.json({ status: 'ok', streams: UPSTREAMS.map((up) => ({ ...up.info, symbols: up.symbols })) }),
)
app.use('/api/livedata', liveDataRoutes)
app.use('/api/analysis', analysisRoutes)

app.use(notFound)
app.use(errorHandler)

const REQUIRED_KEYS = {
  'Stocks & crypto (Alpaca)': ['ALPACA_KEY_ID', 'ALPACA_SECRET_KEY'],
  'Forex history (Twelve Data)': ['TWELVEDATA_API_KEY'],
  'Forex live (Finnhub)': ['FINNHUB_API_KEY'],
}

const server = app.listen(PORT, () => {
  console.log(`API listening on http://localhost:${PORT}`)
  console.log(`Live stream on ws://localhost:${PORT}${STREAM_PATH}`)
  for (const [feature, keys] of Object.entries(REQUIRED_KEYS)) {
    const unset = keys.filter((k) => !process.env[k])
    if (unset.length) console.warn(`${feature}: ${unset.join(', ')} not set — this data will be unavailable`)
  }
  checkOllama().catch((err) =>
    console.warn(`AI analysis (Ollama at ${ollamaUrl()}): ${err.message.startsWith('model') ? err.message : 'not reachable'} — signals will be unavailable`),
  )
})
attachLiveStream(server, origins)
for (const up of UPSTREAMS) {
  up.on('status', ({ provider, state, message }) => console.log(`${provider} stream: ${state}${message ? ` — ${message}` : ''}`))
}

// Close upstream sockets on exit so a restart (e.g. `node --watch`) doesn't hit connection limits.
for (const signal of ['SIGINT', 'SIGTERM']) {
  process.on(signal, () => {
    for (const up of UPSTREAMS) up.close()
    server.close(() => process.exit(0))
    setTimeout(() => process.exit(0), 1000).unref()
  })
}
