import { useEffect, useRef, useState } from 'react'
import { ASSET_BY_SYMBOL } from '../data/markets'
import { changeOf, fmtNumber } from '../lib/format'
import { Avatar, Delta, LivePrice } from './Bits'
import { FILTERS } from './filters'
import { SearchIcon, SettingsIcon } from './Icons'

export function IconRail({ filter, onFilter }) {
  return (
    <nav className="rail" aria-label="Markets">
      <div className="rail__logo mono" aria-hidden="true">SM</div>
      {FILTERS.map(({ id, label, icon: Icon }) => (
        <button
          key={id}
          type="button"
          className={`rail__btn${filter === id ? ' is-active' : ''}`}
          onClick={() => onFilter(id)}
          aria-label={label}
          aria-current={filter === id ? 'page' : undefined}
          title={label}
        >
          <Icon />
        </button>
      ))}
      <div className="rail__spacer" />
      <button type="button" className="rail__btn" aria-label="Settings" title="Settings">
        <SettingsIcon />
      </button>
    </nav>
  )
}

function useClock() {
  const [now, setNow] = useState(() => new Date())
  useEffect(() => {
    const id = setInterval(() => setNow(new Date()), 1000)
    return () => clearInterval(id)
  }, [])
  return now
}

export function TopBar({ query, onQuery, onSubmit }) {
  const inputRef = useRef(null)
  const now = useClock()

  useEffect(() => {
    const onKey = (e) => {
      if (e.key === '/' && document.activeElement !== inputRef.current && !document.querySelector('dialog[open]')) {
        e.preventDefault()
        inputRef.current.focus()
      }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [])

  return (
    <header className="topbar">
      <form
        className="search"
        role="search"
        onSubmit={(e) => {
          e.preventDefault()
          onSubmit()
        }}
      >
        <SearchIcon size={18} className="search__icon" />
        <input
          ref={inputRef}
          type="search"
          value={query}
          onChange={(e) => onQuery(e.target.value)}
          placeholder="Search stocks, currencies, crypto"
          aria-label="Search markets"
        />
        <kbd className="mono">/</kbd>
      </form>
      <div className="status-pill">
        <span className="status-dot" aria-hidden="true" />
        <span className="caption">Live</span>
        <span className="mono caption">{now.toLocaleTimeString('en-GB')}</span>
      </div>
      <span className="account" aria-label="Account">IH</span>
    </header>
  )
}

export function FilterBar({ filter, onFilter, counts }) {
  return (
    <div className="filter-bar" role="tablist" aria-label="Market type">
      {FILTERS.map(({ id, label }) => (
        <button
          key={id}
          type="button"
          role="tab"
          aria-selected={filter === id}
          className="pill"
          onClick={() => onFilter(id)}
        >
          {label}
          <span className="pill__count mono">{counts[id]}</span>
        </button>
      ))}
    </div>
  )
}

function SidebarRow({ asset, quote, onOpen }) {
  return (
    <li>
      <button type="button" className="side-row" onClick={() => onOpen(asset.symbol)}>
        <Avatar asset={asset} size={28} square />
        <span className="side-row__name">
          <span className="truncate">{asset.name}</span>
          <span className="caption fog mono">{asset.symbol}</span>
        </span>
        <span className="side-row__price">
          <LivePrice asset={asset} quote={quote} />
          <Delta quote={quote} />
        </span>
      </button>
    </li>
  )
}

const SIDE_TABS = [
  ['gainers', 'Gainers'],
  ['losers', 'Losers'],
  ['watch', 'Watchlist'],
]

export function Sidebar({ quotes, watchlist, onOpen }) {
  const [tab, setTab] = useState('gainers')
  const symbols = Object.keys(quotes)
  let rows
  if (tab === 'watch') rows = watchlist.filter((s) => quotes[s])
  else {
    const sign = tab === 'gainers' ? -1 : 1
    rows = symbols.sort((a, b) => sign * (changeOf(quotes[a]) - changeOf(quotes[b]))).slice(0, 10)
  }

  return (
    <aside className="sidebar" aria-label="Top movers">
      <div className="sidebar__head">
        <h2 className="heading-sm">Top movers</h2>
        <div className="segmented" role="tablist">
          {SIDE_TABS.map(([id, label]) => (
            <button key={id} type="button" role="tab" aria-selected={tab === id} className="pill pill--sm" onClick={() => setTab(id)}>
              {label}
            </button>
          ))}
        </div>
      </div>
      <div className="side-cols caption fog">
        <span>Instrument</span>
        <span>Price / Chg</span>
      </div>
      {rows.length ? (
        <ul className="side-list">
          {rows.map((s) => (
            <SidebarRow key={s} asset={ASSET_BY_SYMBOL[s]} quote={quotes[s]} onOpen={onOpen} />
          ))}
        </ul>
      ) : (
        <p className="empty caption fog">Star an instrument from its chart window to track it here.</p>
      )}
    </aside>
  )
}

export function Footer({ quotes }) {
  const ticker = ['BTC', 'EUR/USD', 'AAPL']
  return (
    <footer className="footer">
      <nav className="footer__links caption">
        <a href="#markets">Markets</a>
        <a href="#data">Data sources</a>
        <a href="#terms">Terms of Service</a>
        <a href="#privacy">Privacy Policy</a>
      </nav>
      <div className="footer__ticker caption">
        {ticker.map((s) => (
          <span key={s} className="mono">
            <span className="fog">{s}</span> {fmtNumber(quotes[s].price, ASSET_BY_SYMBOL[s].dp)}
          </span>
        ))}
        <span className="fog">Simulated data</span>
      </div>
    </footer>
  )
}
