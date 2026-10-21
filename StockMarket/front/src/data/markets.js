// Instrument catalogue. Everything comes live from the API (see hooks/useMarket.js):
// stocks and crypto from Alpaca, currencies from Twelve Data + Finnhub.

export const TYPES = {
  stock: { label: 'Stocks', prefix: '$' },
  forex: { label: 'Currencies', prefix: '' },
  crypto: { label: 'Crypto', prefix: '$' },
}

// Chart ranges offered by the API.
export const RANGES = ['1D', '1W', '1M', '1Y', '5Y']

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

const CRYPTO_GLYPHS = { BTC: '₿', ETH: 'Ξ', SOL: '◎', ADA: '₳', DOGE: 'Ð', LTC: 'Ł', XRP: 'X' }

// Builds the front-end asset shape from an /api/livedata/crypto quote ("BTC/USD").
export function cryptoAsset(q) {
  const base = q.symbol.split('/')[0]
  return {
    symbol: q.symbol,
    name: q.name || base,
    type: 'crypto',
    venue: 'Alpaca',
    glyph: CRYPTO_GLYPHS[base] ?? base.slice(0, 2),
    // Sub-dollar coins (DOGE, ADA, SHIB…) need more decimals.
    dp: q.price >= 1 ? 2 : q.price >= 0.01 ? 4 : 8,
    live: true,
  }
}
