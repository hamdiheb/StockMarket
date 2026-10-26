// AI trade signal for one instrument: multi-timeframe indicators → local LLM → validation → confidence gate.
// The model only interprets numbers computed here; every number it returns is checked before it reaches
// the browser, and anything short of a clear, stable, high-confidence setup comes back as "stand aside".
import { HttpError } from '../middlewares/errorHandler.js'
import { getBars, getClock, getCryptoBars, getCryptoSnapshots, getSnapshots } from './alpaca.js'
import { cached, forget } from './cache.js'
import { summarize } from './indicators.js'
import { chatSignal, provider } from './llm.js'
import { getForexBars, getForexSnapshots } from './twelveData.js'

const ANALYSIS_CACHE_MS = 60e3 // full result: re-checked against fresh prices every minute
const LLM_CACHE_MS = 10 * 60e3 // model answer: reused until a new 5-minute bar closes (keyed by bar)
const MIN_SETUP_SCORE = 80
const MAX_EMA20_CROSSES = 6 // in the last 20 bars: more than this is chop
const VOLATILITY_SPIKE = 1.5 // ATR% vs its recent average
const MIN_RR = 2
const STOP_ATR = { min: 0.75, max: 3 } // stop distance in ATRs of the trade's timeframe (model is told 1–3)

// Forex distances are quoted in pips (0.0001, or 0.01 for JPY pairs); stocks and crypto in price points.
function distanceUnit(type, symbol) {
  if (type === 'forex') return { unit: 'pips', size: symbol.endsWith('/JPY') ? 0.01 : 0.0001 }
  return { unit: 'points', size: 1 }
}

// Distance from the entry to a level, in pips/points and as a percent of the entry.
function distance(entry, level, { size }) {
  const d = Math.abs(level - entry)
  return { value: Number((d / size).toFixed(size === 1 ? 4 : 1)), pct: Number(((d / entry) * 100).toFixed(2)) }
}

// Turns validated entry/stop/target into the plan shown to the user: distances for each level and a first
// partial target at 1:1 (take part of the position there and move the stop to the entry).
export function tradePlan(type, symbol, signal, entry, stopLoss, takeProfit) {
  const dir = signal === 'BUY' ? 1 : -1
  const risk = Math.abs(entry - stopLoss)
  const unit = distanceUnit(type, symbol)
  const takeProfit1 = entry + dir * risk
  return {
    takeProfit1,
    distances: {
      unit: unit.unit,
      pipSize: type === 'forex' ? unit.size : null,
      stop: distance(entry, stopLoss, unit),
      target1: distance(entry, takeProfit1, unit),
      target2: distance(entry, takeProfit, unit),
    },
    management: 'Take part of the profit at target 1 and move the stop to the entry, so the rest runs risk-free to target 2.',
  }
}
export const minConfidence = () => Number(process.env.MIN_CONFIDENCE) || 80

export const TIMEFRAMES = {
  '1D': 'intraday, 5-minute bars',
  '1W': 'one week, 1-hour bars',
  '1M': 'one month, 4-hour bars',
  '1Y': 'one year, daily bars',
}

const firstQuote = ({ quotes }) => quotes[0] ?? null
const ageMin = (iso) => (iso ? (Date.now() - Date.parse(iso)) / 60e3 : Infinity)

const SOURCES = {
  stock: {
    bars: (symbol, range) => getBars(symbol, range === '1D' ? 'INTRADAY' : range),
    quote: (s) => getSnapshots([s]).then(firstQuote),
    async staleReason() {
      const clock = await getClock().catch(() => null)
      return clock && !clock.isOpen ? 'US stock market is closed — prices are not moving' : null
    },
  },
  crypto: {
    bars: getCryptoBars,
    quote: (s) => getCryptoSnapshots([s]).then(firstQuote),
    staleReason: async (q) => (ageMin(q.updatedAt) > 15 ? 'No recent crypto quotes — data is stale' : null),
  },
  forex: {
    bars: getForexBars,
    quote: (s) => getForexSnapshots([s]).then(firstQuote),
    // Snapshots are cached up to 15 min on 5-min bars; older than that means the FX market is closed.
    staleReason: async (q) => (ageMin(q.updatedAt) > 45 ? 'Forex market is closed — data is stale' : null),
  },
}

async function buildContext(type, symbol) {
  const source = SOURCES[type]
  const quote = await source.quote(symbol)
  if (!quote?.price) throw new HttpError(404, `No price for ${symbol}`)

  const entries = await Promise.all(
    Object.keys(TIMEFRAMES).map(async (range) => {
      const data = await source.bars(symbol, range).catch(() => null)
      return [range, data ? summarize(data.bars) : null]
    }),
  )
  const timeframes = Object.fromEntries(entries.filter(([, s]) => s))
  if (!timeframes['1D']) throw new HttpError(422, `Not enough recent data to analyze ${symbol}`)

  return { type, symbol, price: quote.price, quote, timeframes, staleReason: await source.staleReason(quote) }
}

// ---- Prompt ----

const num = (v) => (v == null || !Number.isFinite(v) ? null : Number(v.toPrecision(6)))
const pct = (v) => (v == null ? null : Number((v * 100).toFixed(2)))

function promptView(tf) {
  return {
    trend: tf.trend,
    changePct: pct(tf.changePct),
    ema20: num(tf.ema20),
    ema50: num(tf.ema50),
    ema200: num(tf.ema200),
    rsi: tf.rsi == null ? null : Number(tf.rsi.toFixed(1)),
    macdHistogram: num(tf.macd.hist),
    atr: num(tf.atr),
    bollinger: tf.bollinger && { upper: num(tf.bollinger.upper), lower: num(tf.bollinger.lower) },
    volumeVsAverage: tf.volumeRatio == null ? null : Number(tf.volumeRatio.toFixed(2)),
    ema20CrossesLast20Bars: tf.ema20Crosses,
    supports: tf.supports.map((l) => num(l.price)),
    resistances: tf.resistances.map((l) => num(l.price)),
    recentCloses: tf.recentCloses.map(num),
  }
}

const SYSTEM_PROMPT = `You are a cautious technical analyst. You receive pre-computed indicators for one instrument on several timeframes.
Use ONLY the numbers given. Decide BUY, SELL or HOLD.
- BUY only if most timeframes trend up, MACD histograms are positive and RSI is below 70.
- SELL only if most timeframes trend down, MACD histograms are negative and RSI is above 30.
- If timeframes conflict, momentum looks exhausted, or price is choppy (many EMA20 crosses), answer HOLD. HOLD is the default.
- timeframe: the timeframe your trade is based on.
- entry: near the current price, or the nearest support (BUY) / resistance (SELL).
- stopLoss: just beyond the nearest support (BUY: below it) / resistance (SELL: above it), so normal noise doesn't hit it.
  Its distance from the entry MUST be between 1 and 3 ATR of the chosen timeframe. If the nearest level is further
  than 3 ATR away, the trade is too risky: answer HOLD.
- takeProfit: just before the next resistance (BUY) / support (SELL), never beyond it. Its distance from the entry
  MUST be between 2x and 4x the stop distance. If the next level is closer than 2x the stop distance, there is not
  enough room for profit: answer HOLD.
- Give prices only; the server converts them to pips/points and adds a first partial target.
- confidence: 0-100, how strongly ALL the evidence agrees. Only go above 80 when every timeframe agrees.
- For HOLD set entry, stopLoss and takeProfit to 0.
- reasoning: at most 3 short sentences that cite the numbers.`

const SCHEMA = {
  type: 'object',
  properties: {
    reasoning: { type: 'string' },
    signal: { type: 'string', enum: ['BUY', 'SELL', 'HOLD'] },
    confidence: { type: 'integer', minimum: 0, maximum: 100 },
    timeframe: { type: 'string', enum: Object.keys(TIMEFRAMES) },
    entry: { type: 'number' },
    stopLoss: { type: 'number' },
    takeProfit: { type: 'number' },
  },
  required: ['reasoning', 'signal', 'confidence', 'timeframe', 'entry', 'stopLoss', 'takeProfit'],
}

function userPrompt(ctx) {
  return JSON.stringify({
    instrument: ctx.symbol,
    assetClass: ctx.type,
    currentPrice: num(ctx.price),
    timeframes: Object.fromEntries(Object.entries(ctx.timeframes).map(([k, tf]) => [`${k} (${TIMEFRAMES[k]})`, promptView(tf)])),
  })
}

// ---- Validation + gate ----

const opposite = { up: 'down', down: 'up' }

// Market stability and freshness: these block any trade, whatever the model says.
function marketReasons(ctx) {
  const day = ctx.timeframes['1D']
  const reasons = []
  if (day.atrPct != null && day.atrPctAvg && day.atrPct > VOLATILITY_SPIKE * day.atrPctAvg) {
    reasons.push(`Volatility spike: intraday ATR is ${(day.atrPct / day.atrPctAvg).toFixed(1)}× its recent average`)
  }
  if (day.ema20Crosses > MAX_EMA20_CROSSES) {
    reasons.push(`Choppy market: price crossed its 20-bar average ${day.ema20Crosses} times in the last 20 bars`)
  }
  if (ctx.staleReason) reasons.push(ctx.staleReason)
  return reasons
}

// Cheap check before calling the model: could a BUY or SELL pass the gate at all, even with the
// best possible momentum, risk/reward and volume? Uses the same rules as evaluate(), so it never
// skips a setup that would have passed. Returns the reasons to stand aside, or [] to ask the model.
export function prescreen(ctx) {
  const blockers = marketReasons(ctx)
  if (blockers.length) return blockers
  const tfs = ctx.timeframes
  const list = Object.values(tfs)
  const hasVolume = list.some((tf) => tf.volumeRatio != null)
  const possible = ['up', 'down'].some((trend) => {
    if (['1D', '1W'].some((k) => tfs[k]?.trend === opposite[trend])) return false
    const dir = trend === 'up' ? 1 : -1
    const agree = list.filter((tf) => tf.trend === trend && Math.sign(tf.macd.hist ?? 0) === dir).length
    const best = Math.round((40 * agree) / list.length) + 40 + (hasVolume ? 20 : 0)
    return (hasVolume ? best : (best / 80) * 100) >= MIN_SETUP_SCORE
  })
  return possible ? [] : ['No setup forming: the timeframes don’t line up in either direction']
}

// Pure: turns the model's answer into the final result. Exported for testing.
export function evaluate(ctx, out) {
  const tfs = ctx.timeframes
  const day = tfs['1D']
  // Reported even for HOLD, so the user sees why nothing is happening.
  const reasons = marketReasons(ctx)

  const base = {
    modelSignal: out.signal,
    confidence: out.confidence,
    timeframe: out.timeframe,
    reasoning: out.reasoning,
    setupScore: null,
    scoreBreakdown: null,
    riskReward: null,
  }

  if (out.signal === 'HOLD') {
    return { ...base, signal: 'HOLD', actionable: false, entry: null, stopLoss: null, takeProfit: null, standAsideReasons: ['No clear setup', ...reasons] }
  }

  const dir = out.signal === 'BUY' ? 1 : -1
  const trend = dir > 0 ? 'up' : 'down'
  const trig = tfs[out.timeframe] ?? day
  const { entry, stopLoss, takeProfit } = out

  // The model's numbers must make sense before anything else counts.
  const finite = [entry, stopLoss, takeProfit].every((v) => Number.isFinite(v) && v > 0)
  const ordered = finite && (dir > 0 ? stopLoss < entry && entry < takeProfit : stopLoss > entry && entry > takeProfit)
  if (!ordered) reasons.push('The suggested stop-loss / take-profit are on the wrong side of the entry')
  else if (trig.atr && Math.abs(entry - ctx.price) > 2 * trig.atr) reasons.push('The suggested entry is too far from the current price')
  const riskReward = ordered ? Math.abs(takeProfit - entry) / Math.abs(entry - stopLoss) : null
  // Stop must sit outside normal noise but not so far that one loss wipes out several wins.
  if (ordered && trig.atr) {
    const stopAtr = Math.abs(entry - stopLoss) / trig.atr
    if (stopAtr < STOP_ATR.min) reasons.push(`Stop-loss too tight: ${stopAtr.toFixed(1)} ATR from the entry, normal noise would hit it`)
    else if (stopAtr > STOP_ATR.max) reasons.push(`Stop-loss too wide: ${stopAtr.toFixed(1)} ATR from the entry`)
  }
  if (riskReward != null && riskReward > 5) reasons.push(`Take-profit is unrealistic: ${riskReward.toFixed(1)}× the risk`)

  if (out.confidence < minConfidence()) reasons.push(`Model confidence ${out.confidence}% is below ${minConfidence()}%`)

  // Short timeframes pointing the other way: the move is fighting the current tape.
  for (const k of ['1D', '1W']) {
    if (tfs[k]?.trend === opposite[trend]) reasons.push(`Timeframes disagree: the ${k} trend is ${tfs[k].trend}`)
  }
  // Buying overbought / selling oversold is chasing a move that's likely to snap back: never actionable.
  if (trig.rsi != null && (dir > 0 ? trig.rsi > 70 : trig.rsi < 30)) {
    reasons.push(`Momentum exhausted: RSI ${trig.rsi.toFixed(0)} is ${dir > 0 ? 'overbought' : 'oversold'}`)
  }

  // Deterministic setup score, independent of the model.
  const list = Object.values(tfs)
  const agree = list.filter((tf) => tf.trend === trend && Math.sign(tf.macd.hist ?? 0) === dir).length
  const breakdown = {
    trend: Math.round((40 * agree) / list.length),
    momentum: trig.rsi != null && (dir > 0 ? trig.rsi <= 70 : trig.rsi >= 30) ? 20 : 0,
    riskReward: riskReward != null && riskReward >= MIN_RR ? 20 : 0,
    volume: trig.volumeRatio == null ? null : trig.volumeRatio >= 1 ? 20 : 0,
  }
  const points = breakdown.trend + breakdown.momentum + breakdown.riskReward + (breakdown.volume ?? 0)
  // No volume data (forex): score out of the remaining 80.
  const setupScore = Math.round(breakdown.volume == null ? (points / 80) * 100 : points)
  if (setupScore < MIN_SETUP_SCORE) {
    const weak = []
    if (breakdown.trend < 40) weak.push(`${agree}/${list.length} timeframes confirm the ${trend}trend`)
    if (!breakdown.riskReward) weak.push(`risk/reward ${riskReward?.toFixed(2) ?? '—'} is below ${MIN_RR}`)
    if (breakdown.volume === 0) weak.push('volume is below average')
    reasons.push(`Setup score ${setupScore} is below ${MIN_SETUP_SCORE}${weak.length ? `: ${weak.join(', ')}` : ''}`)
  }

  const actionable = reasons.length === 0
  return {
    ...base,
    signal: actionable ? out.signal : 'HOLD',
    actionable,
    // Levels are only handed out for trades that passed every check.
    entry: actionable ? entry : null,
    stopLoss: actionable ? stopLoss : null,
    takeProfit: actionable ? takeProfit : null,
    ...(actionable ? tradePlan(ctx.type, ctx.symbol, out.signal, entry, stopLoss, takeProfit) : { takeProfit1: null, distances: null, management: null }),
    riskReward: riskReward == null ? null : Number(riskReward.toFixed(2)),
    setupScore,
    scoreBreakdown: breakdown,
    standAsideReasons: reasons,
  }
}

// refresh: a manual re-analyze — drop this symbol's cached result and model answer so the model is asked again.
export function analyze(type, symbol, { refresh = false } = {}) {
  if (refresh) {
    forget(`analysis:${type}:${symbol}`)
    forget(`llm:${type}:${symbol}:`)
  }
  return cached(`analysis:${type}:${symbol}`, ANALYSIS_CACHE_MS, async () => {
    const started = Date.now()
    const ctx = await buildContext(type, symbol)
    const day = ctx.timeframes['1D']

    // Nothing could pass the gate: answer without spending a model call.
    const skip = prescreen(ctx)
    let result
    if (skip.length) {
      result = {
        modelSignal: 'HOLD',
        confidence: null,
        timeframe: null,
        reasoning: '',
        signal: 'HOLD',
        actionable: false,
        entry: null,
        stopLoss: null,
        takeProfit: null,
        riskReward: null,
        setupScore: null,
        scoreBreakdown: null,
        standAsideReasons: skip,
        screenedOnly: true,
      }
    } else {
      // The indicators only change when a new 5-minute bar closes, so ask the model once per bar;
      // evaluate() still re-checks that answer against the live price on every call.
      const out = await cached(`llm:${type}:${symbol}:${day.lastBarAt}`, LLM_CACHE_MS, () =>
        chatSignal({ system: SYSTEM_PROMPT, user: userPrompt(ctx), schema: SCHEMA }),
      )
      result = { ...evaluate(ctx, out), screenedOnly: false }
    }

    return {
      symbol,
      type,
      price: ctx.price,
      ...result,
      levels: { supports: day.supports.map((l) => l.price), resistances: day.resistances.map((l) => l.price) },
      provider: provider().name,
      model: provider().model(),
      minConfidence: minConfidence(),
      generatedAt: new Date().toISOString(),
      durationMs: Date.now() - started,
      disclaimer: 'Generated by an AI model from technical indicators only. Not financial advice.',
    }
  })
}
