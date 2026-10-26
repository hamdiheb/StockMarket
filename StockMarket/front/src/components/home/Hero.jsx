import { Link } from 'react-router-dom'
import { Sparkline } from '../Bits'

// Static sample data — the hero is decorative and shouldn't hit the market APIs.
const PREVIEW = [
  { symbol: 'AAPL', price: '231.48', change: '+1.24%', values: [220, 222, 221, 225, 224, 228, 227, 231] },
  { symbol: 'EUR/USD', price: '1.0842', change: '−0.18%', values: [1.09, 1.088, 1.089, 1.086, 1.087, 1.085, 1.084], negative: true },
  { symbol: 'BTC/USD', price: '68,215', change: '+2.71%', values: [64, 65, 64.5, 66, 67, 66.4, 68.2] },
]

export default function Hero() {
  return (
    <section className="hero">
      <div className="home__container hero__inner">
        <div className="hero__copy">
          <span className="pill pill--sm hero__tag">
            <span className="hero__live" aria-hidden="true" /> Live across stocks, FX & crypto
          </span>
          <h1 className="hero__title">Live markets. AI signals. One terminal.</h1>
          <p className="hero__lead fog">
            Track US equities, currencies and digital assets in real time, open any chart in a click, and let AI flag
            entries, stops and targets on the symbols you watch.
          </p>
          <div className="hero__actions">
            <Link to="/markets" className="btn-primary">
              Launch the terminal
            </Link>
            <a href="#pricing" className="btn-outline">
              See pricing
            </a>
          </div>
        </div>

        <div className="card hero__preview" aria-label="Sample market preview">
          <div className="hero__preview-head">
            <span className="label">Watchlist</span>
            <span className="caption fog">Sample data</span>
          </div>
          <ul>
            {PREVIEW.map((row) => (
              <li key={row.symbol} className="hero__row">
                <span className="label mono">{row.symbol}</span>
                <Sparkline values={row.values} negative={row.negative} width={96} height={28} />
                <span className="hero__price">
                  <span className="mono">{row.price}</span>
                  <span className={`caption mono ${row.negative ? 'is-neg' : 'is-pos'}`}>{row.change}</span>
                </span>
              </li>
            ))}
          </ul>
          <div className="hero__signal">
            <span className="hero__badge mono">BUY</span>
            <span className="caption fog mono">AAPL · entry 230.10 · stop 226.40 · T1 236.00</span>
          </div>
        </div>
      </div>
    </section>
  )
}
