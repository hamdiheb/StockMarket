// Hosted open models on Groq (https://console.groq.com/docs/api-reference#chat-create), OpenAI-compatible.
// JSON mode guarantees valid JSON; the schema is described in the prompt and the caller validates the result.
import { HttpError } from '../middlewares/errorHandler.js'

const URL = 'https://api.groq.com/openai/v1/chat/completions'
const TIMEOUT_MS = 60e3

export const groqModel = () => process.env.GROQ_MODEL || 'llama-3.3-70b-versatile'

export async function chatJSON({ system, user, schema }) {
  const key = process.env.GROQ_API_KEY
  if (!key) throw new HttpError(503, 'GROQ_API_KEY is not configured on the server')

  let res
  try {
    res = await fetch(URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${key}` },
      body: JSON.stringify({
        model: groqModel(),
        temperature: 0,
        response_format: { type: 'json_object' },
        messages: [
          { role: 'system', content: `${system}\n\nReply with a single JSON object matching this JSON schema:\n${JSON.stringify(schema)}` },
          { role: 'user', content: user },
        ],
      }),
      signal: AbortSignal.timeout(TIMEOUT_MS),
    })
  } catch (err) {
    if (err.name === 'TimeoutError') throw new HttpError(504, 'Groq did not respond in time')
    throw new HttpError(502, `Could not reach Groq: ${err.message}`)
  }

  if (!res.ok) {
    const detail = (await res.text()).slice(0, 300)
    if (res.status === 401) throw new HttpError(502, 'Groq rejected the API key')
    if (res.status === 429) throw new HttpError(429, 'Groq rate limit reached, try again shortly')
    if (res.status === 404) throw new HttpError(503, `Groq model "${groqModel()}" is not available`)
    throw new HttpError(502, `Groq error ${res.status}: ${detail}`)
  }

  const body = await res.json()
  try {
    return JSON.parse(body.choices?.[0]?.message?.content)
  } catch {
    throw new HttpError(502, 'Groq returned invalid JSON')
  }
}

// Startup check: is the key valid and the model available?
export async function checkGroq() {
  const res = await fetch('https://api.groq.com/openai/v1/models', {
    headers: { Authorization: `Bearer ${process.env.GROQ_API_KEY}` },
    signal: AbortSignal.timeout(5e3),
  })
  if (!res.ok) throw new Error(res.status === 401 ? 'API key rejected' : `HTTP ${res.status}`)
  const { data = [] } = await res.json()
  if (!data.some((m) => m.id === groqModel())) throw new Error(`model "${groqModel()}" is not available`)
}
