import { useState } from 'react'
import { SignalBadge } from './components/Bits'
import ChartWindow from './components/ChartWindow'
import { FILTERS } from './components/filters'
import { FilterBar, Footer, IconRail, Sidebar, TopBar } from './components/Layout'
import { FeaturedCard, MarketSection } from './components/Market'
import { activeSignal, useAnalysis } from './hooks/useAnalysis'
import { useMarket, useWatchlist } from './hooks/useMarket'
import { fmtDistance, fmtNumber } from './lib/format'
import './App.css'

const SECTIONS = [
  { id: 'stock', title: 'Stocks', subtitle: 'US equities · live from Alpaca', noun: 'stock prices' },
  { id: 'forex', title: 'Currencies', subtitle: 'Major and regional FX pairs · 24h change · Twelve Data + Finnhub live', noun: 'currency rates' },
  { id: 'crypto', title: 'Crypto', subtitle: 'Top digital assets priced in USD · live from Alpaca', noun: 'crypto prices' },
]

// Live-stream provider behind each section (stocks' state shows in the top bar instead).
const STREAM_OF = { forex: 'finnhub', crypto: 'alpacaCrypto' }

function matches(asset, q) {
  return asset.symbol.toLowerCase().includes(q) || asset.name.toLowerCase().includes(q)
}

function SourceNotice({ source, noun }) {
  if (source.status === 'loading') return <p className="fog">Loading live {noun}…</p>
  if (source.status === 'error') {
    return (
      <div className="notice__row">
        <p>
          Couldn’t load live {noun}. <span className="fog">{source.error}</span>
        </p>
        <button type="button" className="btn-outline" onClick={source.retry}>
          Retry
        </button>
      </div>
    )
  }
  return <p className="fog">The data provider returned nothing.</p>
}

// Auto-watch alerts for new actionable signals. Clicking one opens that chart.
function Toasts({ toasts, bySymbol, onOpen, onDismiss }) {
  if (!toasts.length) return null
  return (
    <div className="toasts" role="status" aria-live="polite">
      {toasts.map(({ id, symbol, data }) => {
        const asset = bySymbol[symbol]
        const dp = asset?.dp ?? 2
        return (
          <div key={id} className={`toast toast--${data.signal.toLowerCase()}`}>
            <button type="button" className="toast__body" onClick={() => {
                onOpen(symbol)
                onDismiss(id)
              }}
            >
              <SignalBadge signal={data} />
              <span className="label mono">{symbol}</span>
              <span className="caption fog mono">
                entry {fmtNumber(data.entry, dp)} · stop {fmtNumber(data.stopLoss, dp)}
                {asset && ` (−${fmtDistance(data.distances?.stop, data.distances, asset)})`}
                <br />
                T1 {fmtNumber(data.takeProfit1, dp)} · T2 {fmtNumber(data.takeProfit, dp)}
                {asset && ` (+${fmtDistance(data.distances?.target2, data.distances, asset)})`}
              </span>
            </button>
            <button type="button" className="icon-btn" aria-label="Dismiss" onClick={() => onDismiss(id)}>
              ×
            </button>
          </div>
        )
      })}
    </div>
  )
}

// Appends the live stream's state to a section subtitle when it isn't streaming.
function streamNote(stream) {
  if (!stream || stream.state === 'live') return ''
  if (stream.state === 'error') return ' · live updates offline'
  return ' · connecting to live updates…'
}

export default function App() {
  const { assets, bySymbol, quotes, sources, streams } = useMarket()
  const [watchlist, toggleWatch] = useWatchlist()
  const [filter, setFilter] = useState('all')
  const [query, setQuery] = useState('')
  const [open, setOpen] = useState(null)
  const ai = useAnalysis(bySymbol, watchlist, open)
  const signals = Object.fromEntries(Object.keys(ai.results).map((s) => [s, activeSignal(ai.results[s])]))

  const q = query.trim().toLowerCase()
  const inFilter = (a, id) => id === 'all' || id === a.type || (id === 'watch' && watchlist.includes(a.symbol))
  const visible = assets.filter((a) => inFilter(a, filter) && (!q || matches(a, q)))
  const counts = Object.fromEntries(FILTERS.map(({ id }) => [id, assets.filter((a) => inFilter(a, id)).length]))

  const openFirstMatch = () => visible[0] && setOpen(visible[0].symbol)
  const changeFilter = (id) => {
    setFilter(id)
    document.querySelector('.main')?.scrollTo({ top: 0, behavior: 'smooth' })
  }
  // Live sections show a loading/error notice instead of disappearing.
  const noticeFor = (id) => {
    const source = sources[id]
    const shown = source && (filter === 'all' || filter === id) && !q && source.status !== 'ready'
    return shown ? <SourceNotice source={source} noun={SECTIONS.find((s) => s.id === id).noun} /> : null
  }
  const anyNotice = SECTIONS.some((s) => noticeFor(s.id))

  return (
    <div className="app">
      <IconRail filter={filter} onFilter={changeFilter} />
      <div className="shell">
        <TopBar query={query} onQuery={setQuery} onSubmit={openFirstMatch} stream={streams.alpaca ?? { state: 'connecting' }} market={sources.stock.market} />
        <div className="body">
          <main className="main" id="markets">
            <div className="page">
              <header className="page__head">
                <h1 className="heading-lg">Markets</h1>
                <p className="fog">Live prices across stocks, currencies and crypto. Select any instrument to open its chart.</p>
              </header>
              <FilterBar filter={filter} onFilter={changeFilter} counts={counts} />

              {filter === 'all' && !q && <FeaturedCard quotes={quotes} bySymbol={bySymbol} onOpen={setOpen} />}

              {SECTIONS.map((s) => (
                <MarketSection
                  key={s.id}
                  id={s.id}
                  title={s.title}
                  subtitle={s.subtitle + streamNote(streams[STREAM_OF[s.id]])}
                  assets={visible.filter((a) => a.type === s.id)}
                  quotes={quotes}
                  signals={signals}
                  onOpen={setOpen}
                  onSeeAll={filter === 'all' ? () => changeFilter(s.id) : null}
                  notice={noticeFor(s.id)}
                />
              ))}

              {!visible.length && !anyNotice && (
                <p className="empty fog">
                  {filter === 'watch' && !q ? 'Your watchlist is empty — open a chart and press Watch.' : `No instruments match “${query}”.`}
                </p>
              )}
            </div>
          </main>
          <Sidebar
            quotes={quotes}
            bySymbol={bySymbol}
            watchlist={watchlist}
            signals={signals}
            autoWatch={ai.autoWatch}
            onAutoWatch={ai.setAutoWatch}
            onOpen={setOpen}
          />
        </div>
        <Footer quotes={quotes} bySymbol={bySymbol} stockFeed={sources.stock.feed} />
      </div>

      {open && bySymbol[open] && (
        <ChartWindow
          key={open}
          asset={bySymbol[open]}
          quote={quotes[open]}
          watched={watchlist.includes(open)}
          onToggleWatch={toggleWatch}
          onClose={() => setOpen(null)}
          analysis={ai.results[open]}
          onAnalyze={ai.analyze}
        />
      )}
      <Toasts toasts={ai.toasts} bySymbol={bySymbol} onOpen={setOpen} onDismiss={ai.dismissToast} />
    </div>
  )
}
