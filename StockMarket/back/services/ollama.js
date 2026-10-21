// Local LLM via Ollama (https://github.com/ollama/ollama/blob/main/docs/api.md#generate-a-chat-completion).
// Replies are constrained to a JSON schema (structured outputs).
import { HttpError } from '../middlewares/errorHandler.js'

const TIMEOUT_MS = 300e3 // CPU-only machines need ~2–3 min per analysis

export const ollamaUrl = () => (process.env.OLLAMA_URL || 'http://localhost:11434').replace(/\/+$/, '')
export const ollamaModel = () => process.env.OLLAMA_MODEL || 'llama3'

// A CPU-bound local model handles one request at a time well; queue the rest instead of
// letting them all time out together.
let queue = Promise.resolve()

export function chatJSON({ system, user, schema }) {
  const run = queue.then(() => request({ system, user, schema }))
  queue = run.catch(() => {})
  return run
}

async function request({ system, user, schema }) {
  let res
  try {
    res = await fetch(`${ollamaUrl()}/api/chat`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        model: ollamaModel(),
        stream: false,
        format: schema,
        options: { temperature: 0, num_ctx: 8192 },
        messages: [
          { role: 'system', content: system },
          { role: 'user', content: user },
        ],
      }),
      signal: AbortSignal.timeout(TIMEOUT_MS),
    })
  } catch (err) {
    if (err.name === 'TimeoutError') throw new HttpError(504, `The local model took longer than ${TIMEOUT_MS / 1000}s`)
    throw new HttpError(503, `Can't reach Ollama at ${ollamaUrl()} — is \`ollama serve\` running?`)
  }

  if (!res.ok) {
    const detail = (await res.text()).slice(0, 300)
    if (res.status === 404) throw new HttpError(503, `Ollama model "${ollamaModel()}" is not installed — run \`ollama pull ${ollamaModel()}\``)
    throw new HttpError(502, `Ollama error ${res.status}: ${detail}`)
  }

  const body = await res.json()
  try {
    return JSON.parse(body.message?.content)
  } catch {
    throw new HttpError(502, 'The local model returned invalid JSON')
  }
}

// Startup check: is Ollama up, and is the configured model pulled?
export async function checkOllama() {
  const res = await fetch(`${ollamaUrl()}/api/tags`, { signal: AbortSignal.timeout(3e3) })
  const { models = [] } = await res.json()
  const wanted = ollamaModel()
  const installed = models.some((m) => m.name === wanted || m.name === `${wanted}:latest`)
  if (!installed) throw new Error(`model "${wanted}" is not pulled (run: ollama pull ${wanted})`)
}
