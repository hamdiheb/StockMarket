import { useState } from 'react'
import ChartWindow from './components/ChartWindow'
import { FILTERS } from './components/filters'
import { FilterBar, Footer, IconRail, Sidebar, TopBar } from './components/Layout'
import { FeaturedCard, MarketSection } from './components/Market'
import { ASSETS, ASSET_BY_SYMBOL } from './data/markets'
import { useMarket, useWatchlist } from './hooks/useMarket'
import './App.css'

const SECTIONS = [
  { id: 'stock', title: 'Stocks', subtitle: 'US equities · NASDAQ & NYSE' },
  { id: 'forex', title: 'Currencies', subtitle: 'Major and regional FX pairs' },
  { id: 'crypto', title: 'Crypto', subtitle: 'Top digital assets priced in USD' },
]

function matches(asset, q) {
  return asset.symbol.toLowerCase().includes(q) || asset.name.toLowerCase().includes(q)
}

export default function App() {
  const quotes = useMarket()
  const [watchlist, toggleWatch] = useWatchlist()
  const [filter, setFilter] = useState('all')
  const [query, setQuery] = useState('')
  const [open, setOpen] = useState(null)

  const q = query.trim().toLowerCase()
  const visible = ASSETS.filter(
    (a) => (filter === 'all' || filter === a.type || (filter === 'watch' && watchlist.includes(a.symbol))) && (!q || matches(a, q)),
  )
  const counts = Object.fromEntries(
    FILTERS.map(({ id }) => [
      id,
      ASSETS.filter((a) => id === 'all' || id === a.type || (id === 'watch' && watchlist.includes(a.symbol))).length,
    ]),
  )

  const openFirstMatch = () => visible[0] && setOpen(visible[0].symbol)
  const changeFilter = (id) => {
    setFilter(id)
    document.querySelector('.main')?.scrollTo({ top: 0, behavior: 'smooth' })
  }

  return (
    <div className="app">
      <IconRail filter={filter} onFilter={changeFilter} />
      <div className="shell">
        <TopBar query={query} onQuery={setQuery} onSubmit={openFirstMatch} />
        <div className="body">
          <main className="main" id="markets">
            <div className="page">
              <header className="page__head">
                <h1 className="heading-lg">Markets</h1>
                <p className="fog">Live prices across stocks, currencies and crypto. Select any instrument to open its chart.</p>
              </header>
              <FilterBar filter={filter} onFilter={changeFilter} counts={counts} />

              {filter === 'all' && !q && <FeaturedCard quotes={quotes} onOpen={setOpen} />}

              {SECTIONS.map((s) => (
                <MarketSection
                  key={s.id}
                  {...s}
                  assets={visible.filter((a) => a.type === s.id)}
                  quotes={quotes}
                  onOpen={setOpen}
                  onSeeAll={filter === 'all' ? () => changeFilter(s.id) : null}
                />
              ))}

              {!visible.length && (
                <p className="empty fog">
                  {filter === 'watch' && !q ? 'Your watchlist is empty — open a chart and press Watch.' : `No instruments match “${query}”.`}
                </p>
              )}
            </div>
          </main>
          <Sidebar quotes={quotes} watchlist={watchlist} onOpen={setOpen} />
        </div>
        <Footer quotes={quotes} />
      </div>

      {open && (
        <ChartWindow
          key={open}
          asset={ASSET_BY_SYMBOL[open]}
          quote={quotes[open]}
          watched={watchlist.includes(open)}
          onToggleWatch={toggleWatch}
          onClose={() => setOpen(null)}
        />
      )}
    </div>
  )
}
