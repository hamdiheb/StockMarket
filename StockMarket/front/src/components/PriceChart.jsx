import { useEffect, useMemo, useRef, useState } from 'react'
import { fmtAxisTime, fmtCompact, fmtFullTime, fmtNumber } from '../lib/format'

const PAD_T = 12
const PAD_R = 72
const PAD_B = 24

function niceStep(raw) {
  const p = 10 ** Math.floor(Math.log10(raw))
  const f = raw / p
  return (f < 1.5 ? 1 : f < 3 ? 2 : f < 7 ? 5 : 10) * p
}

// `signal` (optional): an actionable AI signal { signal, entry, stopLoss, takeProfit } drawn as level lines.
export default function PriceChart({ candles, mode = 'line', range, dp, height = 360, showLegend = true, signal = null }) {
  const wrapRef = useRef(null)
  const [width, setWidth] = useState(720)
  const [hover, setHover] = useState(null)

  useEffect(() => {
    const el = wrapRef.current
    const ro = new ResizeObserver(([entry]) => setWidth(Math.max(240, entry.contentRect.width)))
    ro.observe(el)
    return () => ro.disconnect()
  }, [])

  const geo = useMemo(() => {
    const n = candles.length
    const plotW = width - PAD_R
    const plotH = height - PAD_T - PAD_B
    // Forex has no traded volume: drop the volume pane and give the price the full height.
    const maxVol = Math.max(...candles.map((c) => c.v || 0))
    const hasVolume = maxVol > 0
    const volH = hasVolume ? plotH * 0.16 : 0
    const priceH = plotH - volH - (hasVolume ? 8 : 0)
    const lows = candles.map((c) => (mode === 'line' ? c.c : c.l))
    const highs = candles.map((c) => (mode === 'line' ? c.c : c.h))
    // Signal levels widen the scale so entry, stop and target are always visible.
    const levels = signal ? [signal.entry, signal.stopLoss, signal.takeProfit] : []
    let min = Math.min(...lows, ...levels)
    let max = Math.max(...highs, ...levels)
    const padding = (max - min) * 0.08 || max * 0.01
    min -= padding
    max += padding
    const slot = plotW / n
    const x = (i) => (i + 0.5) * slot
    const y = (p) => PAD_T + ((max - p) / (max - min)) * priceH
    const volTop = PAD_T + priceH + 8

    const step = niceStep((max - min) / 4)
    const tickDp = Math.min(dp, Math.max(0, -Math.floor(Math.log10(step))))
    const yTicks = []
    for (let v = Math.ceil(min / step) * step; v <= max; v += step) yTicks.push(v)

    const xCount = Math.max(2, Math.floor(plotW / 110))
    const xTicks = Array.from({ length: xCount }, (_, k) => Math.round(((k + 0.5) / xCount) * (n - 1)))

    const line = candles.map((c, i) => `${i ? 'L' : 'M'}${x(i).toFixed(1)},${y(c.c).toFixed(1)}`).join('')
    const area = `${line}L${x(n - 1).toFixed(1)},${PAD_T + priceH}L${x(0).toFixed(1)},${PAD_T + priceH}Z`

    return { n, plotW, priceH, volH, volTop, slot, x, y, maxVol, hasVolume, yTicks, tickDp, xTicks, line, area }
  }, [candles, mode, width, height, dp, signal])

  const onMove = (e) => {
    const rect = e.currentTarget.getBoundingClientRect()
    const mx = e.clientX - rect.left
    if (mx > geo.plotW) return setHover(null)
    setHover(Math.min(geo.n - 1, Math.max(0, Math.floor(mx / geo.slot))))
  }

  const last = candles[candles.length - 1]
  const active = hover != null ? candles[hover] : last
  const first = candles[0]
  const rangeChange = last.c / first.o - 1
  const bodyW = Math.max(1, geo.slot * 0.62)

  return (
    <div className="chart" ref={wrapRef}>
      {showLegend && (
        <div className="chart-legend mono">
          <span className="chart-legend__time">{fmtFullTime(active.t, range)}</span>
          <span>O <b>{fmtNumber(active.o, dp)}</b></span>
          <span>H <b>{fmtNumber(active.h, dp)}</b></span>
          <span>L <b>{fmtNumber(active.l, dp)}</b></span>
          <span>C <b>{fmtNumber(active.c, dp)}</b></span>
          {geo.hasVolume && <span>Vol <b>{fmtCompact(active.v)}</b></span>}
          {hover == null && (
            <span className={rangeChange < 0 ? 'is-neg' : 'is-pos'}>
              {range} {rangeChange >= 0 ? '+' : ''}
              {(rangeChange * 100).toFixed(2)}%
            </span>
          )}
        </div>
      )}
      <svg
        className="chart-svg"
        width={width}
        height={height}
        viewBox={`0 0 ${width} ${height}`}
        onPointerMove={onMove}
        onPointerLeave={() => setHover(null)}
        role="img"
        aria-label={`Price chart, ${range}`}
      >
        {geo.yTicks.map((v) => (
          <g key={v}>
            <line x1="0" x2={geo.plotW} y1={geo.y(v)} y2={geo.y(v)} className="chart-grid" />
            <text x={geo.plotW + 8} y={geo.y(v) + 4} className="chart-axis">
              {fmtNumber(v, geo.tickDp)}
            </text>
          </g>
        ))}
        {geo.xTicks.map((i) => (
          <text key={i} x={geo.x(i)} y={height - 6} textAnchor="middle" className="chart-axis">
            {fmtAxisTime(candles[i].t, range)}
          </text>
        ))}

        {geo.hasVolume && candles.map((c, i) => {
          const h = (c.v / geo.maxVol) * geo.volH
          return (
            <rect
              key={`v${i}`}
              x={geo.x(i) - bodyW / 2}
              y={geo.volTop + geo.volH - h}
              width={bodyW}
              height={h}
              className={c.c < c.o ? 'chart-vol is-down' : 'chart-vol'}
            />
          )
        })}

        {mode === 'line' ? (
          <>
            <path d={geo.area} className="chart-area" />
            <path d={geo.line} className="chart-line" />
          </>
        ) : (
          candles.map((c, i) => {
            const down = c.c < c.o
            const top = geo.y(Math.max(c.o, c.c))
            const bottom = geo.y(Math.min(c.o, c.c))
            return (
              <g key={`c${i}`} className={down ? 'candle is-down' : 'candle'}>
                <line x1={geo.x(i)} x2={geo.x(i)} y1={geo.y(c.h)} y2={geo.y(c.l)} />
                <rect x={geo.x(i) - bodyW / 2} y={top} width={bodyW} height={Math.max(1, bottom - top)} />
              </g>
            )
          })
        )}

        {signal &&
          [
            ['Target 2', signal.takeProfit, 'tp'],
            ['Target 1', signal.takeProfit1, 'tp1'],
            ['Entry', signal.entry, 'entry'],
            ['Stop', signal.stopLoss, 'sl'],
          ]
            .filter(([, price]) => price != null)
            .map(([label, price, kind]) => (
            <g key={kind} className={`chart-level chart-level--${kind}`} pointerEvents="none">
              <line x1="0" x2={geo.plotW} y1={geo.y(price)} y2={geo.y(price)} />
              <text x={geo.plotW - 6} y={geo.y(price) - 5} textAnchor="end" className="chart-level__label">
                {label}
              </text>
              <g transform={`translate(${geo.plotW + 2}, ${geo.y(price) - 10})`}>
                <rect width={PAD_R - 4} height="20" rx="4" />
                <text x="6" y="14" className="chart-chip-text">{fmtNumber(price, dp)}</text>
              </g>
            </g>
          ))}
        {signal && (
          // ▲ under the entry for BUY, ▼ above it for SELL, at the latest candle.
          <path
            className={`chart-marker chart-marker--${signal.signal.toLowerCase()}`}
            transform={`translate(${geo.x(geo.n - 1)}, ${geo.y(signal.entry) + (signal.signal === 'BUY' ? 14 : -14)})`}
            d={signal.signal === 'BUY' ? 'M0,-7L7,6L-7,6Z' : 'M0,7L7,-6L-7,-6Z'}
            pointerEvents="none"
          />
        )}

        <line x1="0" x2={geo.plotW} y1={geo.y(last.c)} y2={geo.y(last.c)} className="chart-last-line" />
        <g transform={`translate(${geo.plotW + 2}, ${geo.y(last.c) - 10})`}>
          <rect width={PAD_R - 4} height="20" rx="4" className="chart-chip chart-chip--last" />
          <text x="6" y="14" className="chart-chip-text">{fmtNumber(last.c, dp)}</text>
        </g>

        {hover != null && (
          <g pointerEvents="none">
            <line x1={geo.x(hover)} x2={geo.x(hover)} y1={PAD_T} y2={height - PAD_B} className="chart-cross" />
            <line x1="0" x2={geo.plotW} y1={geo.y(active.c)} y2={geo.y(active.c)} className="chart-cross" />
            {mode === 'line' && <circle cx={geo.x(hover)} cy={geo.y(active.c)} r="4" className="chart-dot" />}
            <g transform={`translate(${geo.plotW + 2}, ${geo.y(active.c) - 10})`}>
              <rect width={PAD_R - 4} height="20" rx="4" className="chart-chip" />
              <text x="6" y="14" className="chart-chip-text">{fmtNumber(active.c, dp)}</text>
            </g>
          </g>
        )}
      </svg>
    </div>
  )
}
