import { TYPES } from '../data/markets'

export function fmtNumber(value, dp = 2) {
  return value.toLocaleString('en-US', { minimumFractionDigits: dp, maximumFractionDigits: dp })
}

export function fmtPrice(value, asset) {
  return TYPES[asset.type].prefix + fmtNumber(value, asset.dp)
}

export function fmtPct(ratio) {
  const pct = ratio * 100
  return `${pct >= 0 ? '+' : ''}${pct.toFixed(2)}%`
}

const compact = new Intl.NumberFormat('en-US', { notation: 'compact', maximumFractionDigits: 2 })
export function fmtCompact(value) {
  return compact.format(value)
}

// A trade-plan distance from the API: "25.0 pips" for forex, "$4.20 (1.22%)" for stocks and crypto.
export function fmtDistance(d, distances, asset) {
  if (!d || !distances) return ''
  if (distances.unit === 'pips') return `${d.value.toFixed(1)} pips`
  return `${fmtPrice(d.value, asset)} (${d.pct.toFixed(2)}%)`
}

// Change vs the previous close (the day's open when there is none).
export function changeOf(quote) {
  return quote.price / (quote.prevClose || quote.open) - 1
}

export function fmtAxisTime(t, range) {
  const d = new Date(t)
  switch (range) {
    case '1D':
      return d.toLocaleTimeString('en-US', { hour: '2-digit', minute: '2-digit', hour12: false })
    case '1W':
      return d.toLocaleDateString('en-US', { weekday: 'short', day: 'numeric' })
    case '1M':
      return d.toLocaleDateString('en-US', { month: 'short', day: 'numeric' })
    case '1Y':
      return d.toLocaleDateString('en-US', { month: 'short', year: '2-digit' })
    default:
      return String(d.getFullYear())
  }
}

export function fmtFullTime(t, range) {
  const d = new Date(t)
  const date = d.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })
  if (range === '1Y' || range === '5Y') return date
  return `${date} ${d.toLocaleTimeString('en-US', { hour: '2-digit', minute: '2-digit', hour12: false })}`
}
