import { useMemo, useState } from 'react'
import { ASSET_BY_SYMBOL, TYPES, generateCandles } from '../data/markets'
import { changeOf, fmtCompact, fmtNumber } from '../lib/format'
import { Avatar, Delta, LivePrice, Sparkline } from './Bits'
import { ExpandIcon } from './Icons'
import PriceChart from './PriceChart'

const FEATURED = ['NVDA', 'BTC', 'EUR/USD', 'TSLA']

export function FeaturedCard({ quotes, onOpen }) {
  const [symbol, setSymbol] = useState(FEATURED[0])
  const asset = ASSET_BY_SYMBOL[symbol]
  const quote = quotes[symbol]
  const base = useMemo(() => generateCandles(asset, '1M'), [asset])
  const candles = useMemo(() => {
    const next = base.slice()
    next[next.length - 1] = { ...next[next.length - 1], c: quote.price }
    return next
  }, [base, quote.price])

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
          {FEATURED.map((s) => (
            <button key={s} type="button" role="tab" aria-selected={s === symbol} className="pill pill--sm mono" onClick={() => setSymbol(s)}>
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
        <PriceChart candles={candles} range="1M" dp={asset.dp} height={300} showLegend={false} />
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

export function MarketSection({ id, title, subtitle, assets, quotes, onOpen, onSeeAll }) {
  if (!assets.length) return null
  return (
    <section className="section" aria-labelledby={`sec-${id}`}>
      <header className="section__head">
        <div>
          <h2 id={`sec-${id}`} className="heading-sm">{title}</h2>
          <p className="caption fog">{subtitle}</p>
        </div>
        {onSeeAll && (
          <button type="button" className="link" onClick={onSeeAll}>
            See all
          </button>
        )}
      </header>
      <div className="grid-3">
        {assets.map((a) => (
          <AssetCard key={a.symbol} asset={a} quote={quotes[a.symbol]} onOpen={onOpen} />
        ))}
      </div>
    </section>
  )
}
