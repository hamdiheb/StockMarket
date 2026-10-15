import { useState } from 'react'
import ChartWindow from './components/ChartWindow'
import { FILTERS } from './components/filters'
import { FilterBar, Footer, IconRail, Sidebar, TopBar } from './components/Layout'
import { FeaturedCard, MarketSection } from './components/Market'
import { useMarket, useWatchlist } from './hooks/useMarket'
import './App.css'

const SECTIONS = [
  { id: 'stock', title: 'Stocks', subtitle: 'US equities · live from Alpaca' },
  { id: 'forex', title: 'Currencies', subtitle: 'Major and regional FX pairs · simulated' },
  { id: 'crypto', title: 'Crypto', subtitle: 'Top digital assets priced in USD · simulated' },
]

function matches(asset, q) {
  return asset.symbol.toLowerCase().includes(q) || asset.name.toLowerCase().includes(q)
}

function StocksNotice({ stocks, onRetry }) {
  if (stocks.status === 'loading') return <p className="fog">Loading live stock prices…</p>
  if (stocks.status === 'error') {
    return (
      <div className="notice__row">
        <p>
          Couldn’t load live stock prices. <span className="fog">{stocks.error}</span>
        </p>
        <button type="button" className="btn-outline" onClick={onRetry}>
          Retry
        </button>
      </div>
    )
  }
  return <p className="fog">Alpaca returned no stocks.</p>
}

export default function App() {
  const { assets, bySymbol, quotes, stocks, stream, retryStocks } = useMarket()
  const [watchlist, toggleWatch] = useWatchlist()
  const [filter, setFilter] = useState('all')
  const [query, setQuery] = useState('')
  const [open, setOpen] = useState(null)

  const q = query.trim().toLowerCase()
  const inFilter = (a, id) => id === 'all' || id === a.type || (id === 'watch' && watchlist.includes(a.symbol))
  const visible = assets.filter((a) => inFilter(a, filter) && (!q || matches(a, q)))
  const counts = Object.fromEntries(FILTERS.map(({ id }) => [id, assets.filter((a) => inFilter(a, id)).length]))

  const openFirstMatch = () => visible[0] && setOpen(visible[0].symbol)
  const changeFilter = (id) => {
    setFilter(id)
    document.querySelector('.main')?.scrollTo({ top: 0, behavior: 'smooth' })
  }
  const showStocksNotice = (filter === 'all' || filter === 'stock') && !q && stocks.status !== 'ready'

  return (
    <div className="app">
      <IconRail filter={filter} onFilter={changeFilter} />
      <div className="shell">
        <TopBar query={query} onQuery={setQuery} onSubmit={openFirstMatch} stream={stream} market={stocks.market} />
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
                  {...s}
                  assets={visible.filter((a) => a.type === s.id)}
                  quotes={quotes}
                  onOpen={setOpen}
                  onSeeAll={filter === 'all' ? () => changeFilter(s.id) : null}
                  notice={s.id === 'stock' && showStocksNotice ? <StocksNotice stocks={stocks} onRetry={retryStocks} /> : null}
                />
              ))}

              {!visible.length && !showStocksNotice && (
                <p className="empty fog">
                  {filter === 'watch' && !q ? 'Your watchlist is empty — open a chart and press Watch.' : `No instruments match “${query}”.`}
                </p>
              )}
            </div>
          </main>
          <Sidebar quotes={quotes} bySymbol={bySymbol} watchlist={watchlist} onOpen={setOpen} />
        </div>
        <Footer quotes={quotes} bySymbol={bySymbol} feed={stocks.feed} />
      </div>

      {open && bySymbol[open] && (
        <ChartWindow
          key={open}
          asset={bySymbol[open]}
          quote={quotes[open]}
          watched={watchlist.includes(open)}
          onToggleWatch={toggleWatch}
          onClose={() => setOpen(null)}
        />
      )}
    </div>
  )
}
