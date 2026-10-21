// Technical indicators over bars [{ t, o, h, l, c, v }] (oldest first). Pure functions, no I/O.
// Series functions return arrays aligned with the input, with null until there's enough data.

export function ema(values, period) {
  const out = new Array(values.length).fill(null)
  if (values.length < period) return out
  const k = 2 / (period + 1)
  let prev = values.slice(0, period).reduce((a, b) => a + b, 0) / period
  out[period - 1] = prev
  for (let i = period; i < values.length; i++) out[i] = prev = values[i] * k + prev * (1 - k)
  return out
}

// Wilder's smoothing, as used by RSI and ATR.
function wilder(values, period) {
  const out = new Array(values.length).fill(null)
  if (values.length < period) return out
  let prev = values.slice(0, period).reduce((a, b) => a + b, 0) / period
  out[period - 1] = prev
  for (let i = period; i < values.length; i++) out[i] = prev = (prev * (period - 1) + values[i]) / period
  return out
}

export function rsi(closes, period = 14) {
  const gains = []
  const losses = []
  for (let i = 1; i < closes.length; i++) {
    const d = closes[i] - closes[i - 1]
    gains.push(Math.max(d, 0))
    losses.push(Math.max(-d, 0))
  }
  const g = wilder(gains, period)
  const l = wilder(losses, period)
  // Shifted by one: there's no change for the first close.
  return [null, ...g.map((gain, i) => {
    if (gain == null) return null
    if (gain === 0 && l[i] === 0) return 50 // flat: neither side has momentum
    return l[i] === 0 ? 100 : 100 - 100 / (1 + gain / l[i])
  })]
}

export function macd(closes, fast = 12, slow = 26, signalPeriod = 9) {
  const f = ema(closes, fast)
  const s = ema(closes, slow)
  const line = closes.map((_, i) => (f[i] != null && s[i] != null ? f[i] - s[i] : null))
  const start = line.findIndex((v) => v != null)
  const signal = new Array(closes.length).fill(null)
  if (start >= 0) ema(line.slice(start), signalPeriod).forEach((v, i) => (signal[start + i] = v))
  const hist = line.map((v, i) => (v != null && signal[i] != null ? v - signal[i] : null))
  return { line, signal, hist }
}

export function atr(bars, period = 14) {
  const tr = bars.map((b, i) => {
    if (!i) return b.h - b.l
    const pc = bars[i - 1].c
    return Math.max(b.h - b.l, Math.abs(b.h - pc), Math.abs(b.l - pc))
  })
  return wilder(tr, period)
}

export function bollinger(closes, period = 20, mult = 2) {
  if (closes.length < period) return null
  const window = closes.slice(-period)
  const mid = window.reduce((a, b) => a + b, 0) / period
  const sd = Math.sqrt(window.reduce((a, b) => a + (b - mid) ** 2, 0) / period)
  return { mid, upper: mid + mult * sd, lower: mid - mult * sd }
}

const last = (arr) => arr[arr.length - 1] ?? null
const mean = (arr) => (arr.length ? arr.reduce((a, b) => a + b, 0) / arr.length : null)

// Fractal pivots (a high/low beyond `k` bars on each side), clustered into levels within `tolerance`.
export function levels(bars, price, tolerance, k = 2) {
  const pivots = []
  for (let i = k; i < bars.length - k; i++) {
    const around = [...bars.slice(i - k, i), ...bars.slice(i + 1, i + k + 1)]
    if (around.every((b) => b.h < bars[i].h)) pivots.push(bars[i].h)
    if (around.every((b) => b.l > bars[i].l)) pivots.push(bars[i].l)
  }
  const clusters = []
  for (const p of pivots.sort((a, b) => a - b)) {
    const c = clusters[clusters.length - 1]
    if (c && p - c.max <= tolerance) {
      c.sum += p
      c.max = p
      c.touches++
    } else clusters.push({ sum: p, max: p, touches: 1 })
  }
  const all = clusters.map((c) => ({ price: c.sum / c.touches, touches: c.touches }))
  return {
    supports: all.filter((l) => l.price < price).sort((a, b) => b.price - a.price).slice(0, 3),
    resistances: all.filter((l) => l.price > price).sort((a, b) => a.price - b.price).slice(0, 3),
  }
}

// up / down / sideways from EMA order and the EMA20 slope over the last 5 bars.
function trendOf(closes, e20, e50, e200) {
  const now = last(e20)
  const before = e20[e20.length - 6]
  if (now == null || last(e50) == null || before == null) return 'sideways'
  const slope = now - before
  const longOk = (dir) => last(e200) == null || (dir > 0 ? last(e50) > last(e200) : last(e50) < last(e200))
  if (now > last(e50) && slope > 0 && last(closes) > last(e50) && longOk(1)) return 'up'
  if (now < last(e50) && slope < 0 && last(closes) < last(e50) && longOk(-1)) return 'down'
  return 'sideways'
}

// Everything the analysis needs about one timeframe, as plain numbers.
export function summarize(bars) {
  if (bars.length < 30) return null
  const closes = bars.map((b) => b.c)
  const price = last(closes)
  const e20 = ema(closes, 20)
  const e50 = ema(closes, 50)
  const e200 = ema(closes, 200)
  const m = macd(closes)
  const a = atr(bars)
  const atrNow = last(a)
  const atrPct = a.map((v, i) => (v == null ? null : v / closes[i]))
  const atrPctHistory = atrPct.slice(-51, -1).filter((v) => v != null)

  // Volume: the last bar is still forming, so compare the last 3 completed bars with the 20 before them.
  const vols = bars.map((b) => b.v || 0)
  const hasVolume = vols.some((v) => v > 0)
  const recentVol = mean(vols.slice(-4, -1))
  const baseVol = mean(vols.slice(-24, -4))

  // How often price crossed EMA20 in the last 20 bars: many crosses = choppy, no direction.
  let crosses = 0
  for (let i = closes.length - 19; i < closes.length; i++) {
    if (i < 1 || e20[i] == null || e20[i - 1] == null) continue
    if (Math.sign(closes[i] - e20[i]) !== Math.sign(closes[i - 1] - e20[i - 1])) crosses++
  }

  return {
    bars: bars.length,
    price,
    changePct: price / bars[0].o - 1,
    ema20: last(e20),
    ema50: last(e50),
    ema200: last(e200),
    rsi: last(rsi(closes)),
    macd: { line: last(m.line), signal: last(m.signal), hist: last(m.hist) },
    atr: atrNow,
    atrPct: last(atrPct),
    atrPctAvg: mean(atrPctHistory),
    bollinger: bollinger(closes),
    volumeRatio: hasVolume && baseVol ? recentVol / baseVol : null,
    trend: trendOf(closes, e20, e50, e200),
    ema20Crosses: crosses,
    ...levels(bars, price, (atrNow ?? 0) * 0.5),
    recentCloses: closes.slice(-10),
  }
}
