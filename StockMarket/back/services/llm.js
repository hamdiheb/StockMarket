// Picks the LLM provider: Groq when GROQ_API_KEY is set (fast, hosted), otherwise local Ollama.
import { checkGroq, chatJSON as groqChat, groqModel } from './groq.js'
import { checkOllama, ollamaModel, ollamaUrl, chatJSON as ollamaChat } from './ollama.js'

const PROVIDERS = {
  groq: { name: 'groq', model: groqModel, chat: groqChat, check: checkGroq, where: () => 'api.groq.com' },
  ollama: { name: 'ollama', model: ollamaModel, chat: ollamaChat, check: checkOllama, where: ollamaUrl },
}

export const provider = () => PROVIDERS[process.env.GROQ_API_KEY ? 'groq' : 'ollama']

const SIGNALS = ['BUY', 'SELL', 'HOLD']

// Coerces the model's reply into the expected shape. Anything unusable becomes a HOLD.
function normalize(raw, schema) {
  const out = raw && typeof raw === 'object' ? raw : {}
  const signal = String(out.signal ?? '').toUpperCase()
  const number = (v) => (Number.isFinite(Number(v)) ? Number(v) : 0)
  const timeframes = schema.properties.timeframe.enum
  return {
    reasoning: String(out.reasoning ?? '').slice(0, 600),
    signal: SIGNALS.includes(signal) ? signal : 'HOLD',
    confidence: Math.max(0, Math.min(100, Math.round(number(out.confidence)))),
    timeframe: timeframes.includes(out.timeframe) ? out.timeframe : timeframes[0],
    entry: number(out.entry),
    stopLoss: number(out.stopLoss),
    takeProfit: number(out.takeProfit),
  }
}

export async function chatSignal({ system, user, schema }) {
  return normalize(await provider().chat({ system, user, schema }), schema)
}
