import { useEffect, useRef, useState } from 'react'
import { RANGES, TYPES } from '../data/markets'
import { useCandles, withLivePrice } from '../hooks/useMarket'
import { fmtCompact, fmtNumber, fmtPrice } from '../lib/format'
import { Avatar, Delta, LivePrice } from './Bits'
import { CloseIcon, StarIcon } from './Icons'
import { ChartPlaceholder } from './Market'
import PriceChart from './PriceChart'

const CHART_HEIGHT = 380

export default function ChartWindow({ asset, quote, watched, onToggleWatch, onClose }) {
  const dialogRef = useRef(null)
  const [range, setRange] = useState('1D')
  const [mode, setMode] = useState('line')
  // Simulated history is anchored to the price at open; live stocks ignore this.
  const [anchor] = useState(quote.price)

  useEffect(() => {
    // No close() in cleanup: its async `close` event would dismiss the window under StrictMode.
    const dialog = dialogRef.current
    if (!dialog.open) dialog.showModal()
  }, [])

  const { candles, loading, error } = useCandles(asset, range, anchor)
  const year = useCandles(asset, '1Y', anchor).candles
  const chartCandles = withLivePrice(candles, quote.price)

  const diff = quote.price - quote.prevClose
  const yearHigh = year?.length ? Math.max(quote.high, ...year.map((c) => c.h)) : null
  const yearLow = year?.length ? Math.min(quote.low, ...year.map((c) => c.l)) : null
  const dash = (v) => (v == null ? '—' : fmtNumber(v, asset.dp))

  const lastColumn = {
    stock: ['Prev close', dash(quote.prevClose)],
    forex: ['Spread', `${asset.spread} pips`],
    crypto: ['Market cap', `$${fmtCompact(asset.cap ?? 0)}`],
  }[asset.type]
  const stats = [
    ['Open', dash(quote.open)],
    ['Day high', dash(quote.high)],
    ['Day low', dash(quote.low)],
    [asset.type === 'forex' ? 'Tick volume' : 'Volume', fmtCompact(quote.volume)],
    ['52W high', dash(yearHigh)],
    ['52W low', dash(yearLow)],
    lastColumn,
    ['Source', asset.live ? 'Alpaca · live' : 'Simulated'],
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
          {asset.live && quote.updatedAt && (
            <span className="caption fog">
              · last trade {new Date(quote.updatedAt).toLocaleString('en-GB', { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit', second: '2-digit' })}
            </span>
          )}
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

        {chartCandles?.length ? (
          <PriceChart candles={chartCandles} mode={mode} range={range} dp={asset.dp} height={CHART_HEIGHT} />
        ) : (
          <ChartPlaceholder height={CHART_HEIGHT + 26}>
            {error || (loading ? 'Loading chart…' : 'No trades in this range')}
          </ChartPlaceholder>
        )}

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
