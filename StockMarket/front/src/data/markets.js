// Instrument catalogue. Stocks and currencies come live from the API (see hooks/useMarket.js);
// crypto is still simulated with a deterministic random walk.

export const TYPES = {
  stock: { label: 'Stocks', prefix: '$' },
  forex: { label: 'Currencies', prefix: '' },
  crypto: { label: 'Crypto', prefix: '$' },
}

// Simulated instruments. vol = approximate daily volatility, adv = average daily volume (USD)
export const SIM_ASSETS = [
  { symbol: 'BTC', name: 'Bitcoin', type: 'crypto', venue: 'USD', glyph: '₿', price: 67250.12, vol: 0.03, dp: 2, adv: 2.8e10, cap: 1.33e12 },
  { symbol: 'ETH', name: 'Ethereum', type: 'crypto', venue: 'USD', glyph: 'Ξ', price: 2610.48, vol: 0.035, dp: 2, adv: 1.4e10, cap: 3.14e11 },
  { symbol: 'SOL', name: 'Solana', type: 'crypto', venue: 'USD', glyph: '◎', price: 152.31, vol: 0.045, dp: 2, adv: 2.6e9, cap: 7.16e10 },
  { symbol: 'XRP', name: 'XRP', type: 'crypto', venue: 'USD', glyph: 'X', price: 0.5432, vol: 0.04, dp: 4, adv: 1.3e9, cap: 3.08e10 },
  { symbol: 'BNB', name: 'BNB', type: 'crypto', venue: 'USD', glyph: 'B', price: 584.2, vol: 0.028, dp: 2, adv: 1.6e9, cap: 8.52e10 },
  { symbol: 'ADA', name: 'Cardano', type: 'crypto', venue: 'USD', glyph: '₳', price: 0.3521, vol: 0.045, dp: 4, adv: 3.1e8, cap: 1.23e10 },
]

// Builds the front-end asset shape from an /api/livedata/stocks quote.
export function stockAsset(q) {
  return { symbol: q.symbol, name: q.name || q.symbol, type: 'stock', venue: q.exchange || 'US', glyph: q.symbol.slice(0, 2), dp: 2, live: true }
}

const CURRENCY_GLYPHS = { EUR: '€', GBP: '£', USD: '$', JPY: '¥', CHF: '₣', AUD: 'A$', CAD: 'C$', TND: 'DT', CNY: '¥' }

// Builds the front-end asset shape from an /api/livedata/forex quote ("EUR/USD").
export function forexAsset(q) {
  const [base, quote] = q.symbol.split('/')
  return {
    symbol: q.symbol,
    name: q.name || q.symbol,
    type: 'forex',
    venue: 'FX',
    // USD/JPY shows ¥, not $: the non-dollar side tells the pairs apart.
    glyph: base === 'USD' ? (CURRENCY_GLYPHS[quote] ?? quote) : (CURRENCY_GLYPHS[base] ?? base),
    dp: quote === 'JPY' ? 3 : 5,
    live: true,
  }
}

const DAY = 864e5
export const RANGES = {
  '1D': { points: 96, step: 15 * 60e3 },
  '1W': { points: 168, step: 3600e3 },
  '1M': { points: 120, step: 6 * 3600e3 },
  '1Y': { points: 365, step: DAY },
  '5Y': { points: 260, step: 7 * DAY },
}

const NOW = Date.now()

function hash(str) {
  let h = 1779033703 ^ str.length
  for (let i = 0; i < str.length; i++) {
    h = Math.imul(h ^ str.charCodeAt(i), 3432918353)
    h = (h << 13) | (h >>> 19)
  }
  return h >>> 0
}

function mulberry32(seed) {
  return () => {
    seed |= 0
    seed = (seed + 0x6d2b79f5) | 0
    let t = Math.imul(seed ^ (seed >>> 15), 1 | seed)
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}

export function gaussian(rng = Math.random) {
  const u = 1 - rng()
  const v = rng()
  return Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * v)
}

// Random walk built backwards so the last close lands exactly on `endPrice`.
export function generateCandles(asset, rangeKey, endPrice = asset.price) {
  const { points, step } = RANGES[rangeKey]
  const rng = mulberry32(hash(asset.symbol + rangeKey))
  const stepDays = step / DAY
  const sigma = asset.vol * Math.sqrt(stepDays)
  const drift = (rng() - 0.42) * sigma * 0.2
  const end = Math.floor(NOW / step) * step
  const out = new Array(points)
  let close = endPrice
  for (let i = points - 1; i >= 0; i--) {
    const open = close / Math.exp(gaussian(rng) * sigma + drift)
    const top = Math.max(open, close)
    const bottom = Math.min(open, close)
    out[i] = {
      t: end - (points - 1 - i) * step,
      o: open,
      h: top * Math.exp(Math.abs(gaussian(rng)) * sigma * 0.35),
      l: bottom / Math.exp(Math.abs(gaussian(rng)) * sigma * 0.35),
      c: close,
      v: asset.adv * stepDays * (0.35 + 1.3 * rng()),
    }
    close = open
  }
  return out
}
