import { useState } from 'react'
import { TYPES } from '../data/markets'
import { useCandles, withLivePrice } from '../hooks/useMarket'
import { changeOf, fmtCompact, fmtNumber } from '../lib/format'
import { Avatar, Delta, LivePrice, Sparkline } from './Bits'
import { ExpandIcon } from './Icons'
import PriceChart from './PriceChart'

const FEATURED = ['NVDA', 'TSLA', 'BTC', 'EUR/USD']

export function ChartPlaceholder({ height, children }) {
  return (
    <div className="chart-placeholder caption fog" style={{ height }}>
      {children}
    </div>
  )
}

export function FeaturedCard({ quotes, bySymbol, onOpen }) {
  const available = FEATURED.filter((s) => bySymbol[s] && quotes[s])
  const [picked, setPicked] = useState(FEATURED[0])
  const symbol = available.includes(picked) ? picked : available[0]
  if (!symbol) return null
  return <FeaturedBody key={symbol} symbol={symbol} available={available} onPick={setPicked} quotes={quotes} bySymbol={bySymbol} onOpen={onOpen} />
}

function FeaturedBody({ symbol, available, onPick, quotes, bySymbol, onOpen }) {
  const asset = bySymbol[symbol]
  const quote = quotes[symbol]
  const { candles, loading, error } = useCandles(asset, '1M')
  const chartCandles = withLivePrice(candles, quote.price)

  const strip = [
    ['Open', fmtNumber(quote.open, asset.dp)],
    ['High', fmtNumber(quote.high, asset.dp)],
    ['Low', fmtNumber(quote.low, asset.dp)],
    ['Volume', fmtCompact(quote.volume)],
  ]

  return (
    <section className="card featured" aria-label="Featured instrument">
      <div className="featured__info">
        <div className="featured__tabs segmented" role="tablist" aria-label="Featured instrument">
          {available.map((s) => (
            <button key={s} type="button" role="tab" aria-selected={s === symbol} className="pill pill--sm mono" onClick={() => onPick(s)}>
              {s}
            </button>
          ))}
        </div>
        <div className="featured__id">
          <Avatar asset={asset} size={56} />
          <div>
            <h2 className="heading-sm">
              {asset.name} <span className="verified" aria-hidden="true" />
            </h2>
            <p className="caption fog">
              <span className="mono">{asset.symbol}</span> · {asset.venue} · {TYPES[asset.type].label}
              {!asset.live && ' · simulated'}
            </p>
          </div>
        </div>
        <div className="featured__price">
          <LivePrice asset={asset} quote={quote} className="price-xl" />
          <Delta quote={quote} className="delta-lg" />
        </div>
        <dl className="featured__strip">
          {strip.map(([k, v]) => (
            <div key={k}>
              <dt className="caption fog">{k}</dt>
              <dd className="mono">{v}</dd>
            </div>
          ))}
        </dl>
        <button type="button" className="btn-outline" onClick={() => onOpen(symbol)}>
          <ExpandIcon size={16} /> Open chart
        </button>
      </div>
      <div className="featured__chart">
        {chartCandles?.length ? (
          <PriceChart candles={chartCandles} range="1M" dp={asset.dp} height={300} showLegend={false} />
        ) : (
          <ChartPlaceholder height={300}>{error || (loading ? 'Loading chart…' : 'No trades in this range')}</ChartPlaceholder>
        )}
      </div>
    </section>
  )
}

export function AssetCard({ asset, quote, onOpen }) {
  return (
    <button type="button" className="card asset-card" onClick={() => onOpen(asset.symbol)} aria-label={`Open ${asset.name} chart`}>
      <span className="asset-card__top">
        <Avatar asset={asset} size={32} />
        <span className="asset-card__name">
          <span className="truncate label">
            {asset.name} <span className="dot" aria-hidden="true" />
          </span>
          <span className="caption fog mono">{asset.symbol}</span>
        </span>
        <Sparkline values={quote.spark} negative={changeOf(quote) < 0} />
      </span>
      <span className="asset-card__bottom">
        <LivePrice asset={asset} quote={quote} />
        <Delta quote={quote} />
      </span>
    </button>
  )
}

export function MarketSection({ id, title, subtitle, assets, quotes, onOpen, onSeeAll, notice }) {
  if (!assets.length && !notice) return null
  return (
    <section className="section" aria-labelledby={`sec-${id}`}>
      <header className="section__head">
        <div>
          <h2 id={`sec-${id}`} className="heading-sm">{title}</h2>
          <p className="caption fog">{subtitle}</p>
        </div>
        {onSeeAll && assets.length > 0 && (
          <button type="button" className="link" onClick={onSeeAll}>
            See all
          </button>
        )}
      </header>
      {assets.length > 0 ? (
        <div className="grid-3">
          {assets.map((a) => (
            <AssetCard key={a.symbol} asset={a} quote={quotes[a.symbol]} onOpen={onOpen} />
          ))}
        </div>
      ) : (
        <div className="card notice">{notice}</div>
      )}
    </section>
  )
}
