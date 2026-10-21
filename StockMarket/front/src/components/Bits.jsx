import { changeOf, fmtPct, fmtPrice } from '../lib/format'

export function Avatar({ asset, size = 32, square = false }) {
  return (
    <span
      className={`avatar${square ? ' avatar--square' : ''}`}
      style={{ width: size, height: size, fontSize: Math.round(size * 0.36) }}
      aria-hidden="true"
    >
      {asset.glyph}
    </span>
  )
}

// "BUY 86%" / "SELL 82%" for an actionable AI signal; nothing otherwise.
export function SignalBadge({ signal }) {
  if (!signal) return null
  return (
    <span className={`signal-badge signal-badge--${signal.signal.toLowerCase()}`} title={`AI signal · ${signal.confidence}% confidence`}>
      {signal.signal} {signal.confidence}%
    </span>
  )
}

export function Delta({ quote, className = '' }) {
  const change = changeOf(quote)
  return (
    <span className={`delta ${change < 0 ? 'is-neg' : 'is-pos'} ${className}`}>{fmtPct(change)}</span>
  )
}

// Price text that briefly flashes on every live tick.
export function LivePrice({ asset, quote, className = '' }) {
  const flash = quote.dir > 0 ? 'flash-up' : quote.dir < 0 ? 'flash-down' : ''
  return (
    <span key={quote.tick} className={`mono live-price ${flash} ${className}`}>
      {fmtPrice(quote.price, asset)}
    </span>
  )
}

export function Sparkline({ values, negative, width = 96, height = 32 }) {
  const min = Math.min(...values)
  const max = Math.max(...values)
  const span = max - min || 1
  const points = values
    .map((v, i) => {
      const x = (i / (values.length - 1)) * width
      const y = height - 2 - ((v - min) / span) * (height - 4)
      return `${x.toFixed(1)},${y.toFixed(1)}`
    })
    .join(' ')
  return (
    <svg className="sparkline" width={width} height={height} viewBox={`0 0 ${width} ${height}`} aria-hidden="true">
      <polyline points={points} fill="none" stroke={negative ? 'var(--color-vermilion)' : 'var(--color-ice-signal)'} strokeWidth="1.5" strokeLinejoin="round" />
    </svg>
  )
}
