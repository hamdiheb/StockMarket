// Instrument catalogue + deterministic simulated price history.
// Swap `generateCandles` / `useMarket` for a real data feed when one is available.

export const TYPES = {
  stock: { label: 'Stocks', prefix: '$' },
  forex: { label: 'Currencies', prefix: '' },
  crypto: { label: 'Crypto', prefix: '$' },
}

// vol = approximate daily volatility, adv = average daily volume (shares / tick volume / USD)
export const ASSETS = [
  { symbol: 'AAPL', name: 'Apple Inc.', type: 'stock', venue: 'NASDAQ', glyph: 'AA', price: 231.42, vol: 0.016, dp: 2, adv: 54e6, cap: 3.52e12 },
  { symbol: 'MSFT', name: 'Microsoft Corp.', type: 'stock', venue: 'NASDAQ', glyph: 'MS', price: 428.15, vol: 0.014, dp: 2, adv: 21e6, cap: 3.18e12 },
  { symbol: 'NVDA', name: 'NVIDIA Corp.', type: 'stock', venue: 'NASDAQ', glyph: 'NV', price: 138.07, vol: 0.03, dp: 2, adv: 240e6, cap: 3.39e12 },
  { symbol: 'GOOGL', name: 'Alphabet Inc.', type: 'stock', venue: 'NASDAQ', glyph: 'GO', price: 166.35, vol: 0.017, dp: 2, adv: 25e6, cap: 2.05e12 },
  { symbol: 'AMZN', name: 'Amazon.com Inc.', type: 'stock', venue: 'NASDAQ', glyph: 'AM', price: 187.54, vol: 0.019, dp: 2, adv: 41e6, cap: 1.97e12 },
  { symbol: 'TSLA', name: 'Tesla Inc.', type: 'stock', venue: 'NASDAQ', glyph: 'TS', price: 251.12, vol: 0.035, dp: 2, adv: 92e6, cap: 8.02e11 },
  { symbol: 'META', name: 'Meta Platforms', type: 'stock', venue: 'NASDAQ', glyph: 'ME', price: 586.27, vol: 0.022, dp: 2, adv: 13e6, cap: 1.48e12 },
  { symbol: 'JPM', name: 'JPMorgan Chase', type: 'stock', venue: 'NYSE', glyph: 'JP', price: 222.4, vol: 0.012, dp: 2, adv: 9e6, cap: 6.31e11 },
  { symbol: 'NFLX', name: 'Netflix Inc.', type: 'stock', venue: 'NASDAQ', glyph: 'NF', price: 712.9, vol: 0.022, dp: 2, adv: 3.4e6, cap: 3.05e11 },

  { symbol: 'EUR/USD', name: 'Euro / US Dollar', type: 'forex', venue: 'FX', glyph: '€', price: 1.0912, vol: 0.004, dp: 4, adv: 4.2e5, spread: 0.6 },
  { symbol: 'GBP/USD', name: 'British Pound / US Dollar', type: 'forex', venue: 'FX', glyph: '£', price: 1.3061, vol: 0.005, dp: 4, adv: 3.1e5, spread: 0.9 },
  { symbol: 'USD/JPY', name: 'US Dollar / Japanese Yen', type: 'forex', venue: 'FX', glyph: '¥', price: 149.62, vol: 0.006, dp: 2, adv: 3.6e5, spread: 0.8 },
  { symbol: 'USD/CHF', name: 'US Dollar / Swiss Franc', type: 'forex', venue: 'FX', glyph: '₣', price: 0.8624, vol: 0.005, dp: 4, adv: 1.4e5, spread: 1.2 },
  { symbol: 'AUD/USD', name: 'Australian Dollar / US Dollar', type: 'forex', venue: 'FX', glyph: 'A$', price: 0.6702, vol: 0.006, dp: 4, adv: 1.9e5, spread: 0.8 },
  { symbol: 'EUR/TND', name: 'Euro / Tunisian Dinar', type: 'forex', venue: 'FX', glyph: 'DT', price: 3.3815, vol: 0.003, dp: 4, adv: 2.2e4, spread: 4.5 },

  { symbol: 'BTC', name: 'Bitcoin', type: 'crypto', venue: 'USD', glyph: '₿', price: 67250.12, vol: 0.03, dp: 2, adv: 2.8e10, cap: 1.33e12 },
  { symbol: 'ETH', name: 'Ethereum', type: 'crypto', venue: 'USD', glyph: 'Ξ', price: 2610.48, vol: 0.035, dp: 2, adv: 1.4e10, cap: 3.14e11 },
  { symbol: 'SOL', name: 'Solana', type: 'crypto', venue: 'USD', glyph: '◎', price: 152.31, vol: 0.045, dp: 2, adv: 2.6e9, cap: 7.16e10 },
  { symbol: 'XRP', name: 'XRP', type: 'crypto', venue: 'USD', glyph: 'X', price: 0.5432, vol: 0.04, dp: 4, adv: 1.3e9, cap: 3.08e10 },
  { symbol: 'BNB', name: 'BNB', type: 'crypto', venue: 'USD', glyph: 'B', price: 584.2, vol: 0.028, dp: 2, adv: 1.6e9, cap: 8.52e10 },
  { symbol: 'ADA', name: 'Cardano', type: 'crypto', venue: 'USD', glyph: '₳', price: 0.3521, vol: 0.045, dp: 4, adv: 3.1e8, cap: 1.23e10 },
]

export const ASSET_BY_SYMBOL = Object.fromEntries(ASSETS.map((a) => [a.symbol, a]))

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
