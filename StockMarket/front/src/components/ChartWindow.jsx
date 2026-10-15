import { useEffect, useMemo, useRef, useState } from 'react'
import { RANGES, TYPES, generateCandles } from '../data/markets'
import { fmtCompact, fmtNumber, fmtPrice } from '../lib/format'
import { Avatar, Delta, LivePrice } from './Bits'
import { CloseIcon, StarIcon } from './Icons'
import PriceChart from './PriceChart'

export default function ChartWindow({ asset, quote, watched, onToggleWatch, onClose }) {
  const dialogRef = useRef(null)
  const [range, setRange] = useState('1D')
  const [mode, setMode] = useState('line')
  // History is anchored to the price at open; the live quote then drives the last candle.
  const [anchor] = useState(quote.price)

  useEffect(() => {
    // No close() in cleanup: its async `close` event would dismiss the window under StrictMode.
    const dialog = dialogRef.current
    if (!dialog.open) dialog.showModal()
  }, [])

  const base = useMemo(() => generateCandles(asset, range, anchor), [asset, range, anchor])
  const year = useMemo(() => generateCandles(asset, '1Y', anchor), [asset, anchor])

  const candles = useMemo(() => {
    const next = base.slice()
    const tail = { ...next[next.length - 1] }
    tail.c = quote.price
    tail.h = Math.max(tail.h, quote.price)
    tail.l = Math.min(tail.l, quote.price)
    next[next.length - 1] = tail
    return next
  }, [base, quote.price])

  const diff = quote.price - quote.open
  const yearHigh =Math.max(quote.high, ...year.map((c) => c.h))
  const yearLow = Math.min(quote.low, ...year.map((c) => c.l))

  const stats = [
    ['Open', fmtNumber(quote.open, asset.dp)],
    ['Day high', fmtNumber(quote.high, asset.dp)],
    ['Day low', fmtNumber(quote.low, asset.dp)],
    [asset.type === 'forex' ? 'Tick volume' : 'Volume', fmtCompact(quote.volume)],
    ['52W high', fmtNumber(yearHigh, asset.dp)],
    ['52W low', fmtNumber(yearLow, asset.dp)],
    asset.type === 'forex' ? ['Spread', `${asset.spread} pips`] : ['Market cap', `$${fmtCompact(asset.cap)}`],
    ['Market', `${TYPES[asset.type].label} · ${asset.venue}`],
  ]

  return (
    <dialog
      ref={dialogRef}
      className="window"
      aria-labelledby="window-title"
      onClose={onClose}
      onClick={(e) => e.target === e.currentTarget && onClose()}
    >
      <div className="window__inner">
        <header className="window__head">
          <Avatar asset={asset} size={40} />
          <div className="window__title">
            <h2 id="window-title">
              {asset.name} <span className="verified" aria-hidden="true" />
            </h2>
            <p className="caption fog">
              <span className="mono">{asset.symbol}</span> · {asset.venue} · {TYPES[asset.type].label}
            </p>
          </div>
          <button type="button" className="btn-outline" onClick={() => onToggleWatch(asset.symbol)} aria-pressed={watched}>
            <StarIcon size={16} filled={watched} />
            {watched ? 'Watching' : 'Watch'}
          </button>
          <button type="button" className="icon-btn" onClick={onClose} aria-label="Close chart" autoFocus>
            <CloseIcon size={20} />
          </button>
        </header>

        <div className="window__price">
          <LivePrice asset={asset} quote={quote} className="price-xl" />
          <Delta quote={quote} className="delta-lg" />
          <span className="caption fog">
            <span className="mono">{diff >= 0 ? '+' : '−'}{fmtPrice(Math.abs(diff), asset)}</span> today
          </span>
        </div>

        <div className="window__toolbar">
          <div className="segmented" role="tablist" aria-label="Time range">
            {Object.keys(RANGES).map((key) => (
              <button key={key} type="button" role="tab" aria-selected={range === key} className="pill" onClick={() => setRange(key)}>
                {key}
              </button>
            ))}
          </div>
          <div className="segmented" role="tablist" aria-label="Chart type">
            {['line', 'candles'].map((m) => (
              <button key={m} type="button" role="tab" aria-selected={mode === m} className="pill" onClick={() => setMode(m)}>
                {m === 'line' ? 'Line' : 'Candles'}
              </button>
            ))}
          </div>
        </div>

        <PriceChart candles={candles} mode={mode} range={range} dp={asset.dp} height={380} />

        <dl className="stats">
          {stats.map(([label, value]) => (
            <div key={label} className="stat">
              <dt className="caption fog">{label}</dt>
              <dd className="mono">{value}</dd>
            </div>
          ))}
        </dl>
      </div>
    </dialog>
  )
}
