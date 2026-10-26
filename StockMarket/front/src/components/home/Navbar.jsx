import { useState } from 'react'
import { Link } from 'react-router-dom'
import { CloseIcon } from '../Icons'

const LINKS = [
  { href: '#product', label: 'Product' },
  { href: '#pricing', label: 'Pricing' },
]

export default function Navbar() {
  const [open, setOpen] = useState(false)
  const close = () => setOpen(false)

  return (
    <header className="nav">
      <div className="home__container nav__inner">
        <Link to="/" className="nav__brand" onClick={close}>
          <span className="rail__logo mono" aria-hidden="true">SM</span>
          <span className="label">StockMarket</span>
        </Link>

        <button
          type="button"
          className="icon-btn nav__toggle"
          aria-label={open ? 'Close menu' : 'Open menu'}
          aria-expanded={open}
          aria-controls="nav-menu"
          onClick={() => setOpen((o) => !o)}
        >
          {open ? <CloseIcon size={20} /> : <span className="nav__burger" aria-hidden="true" />}
        </button>

        <nav id="nav-menu" className={`nav__menu${open ? ' is-open' : ''}`} aria-label="Main">
          {LINKS.map(({ href, label }) => (
            <a key={href} href={href} className="nav__link" onClick={close}>
              {label}
            </a>
          ))}
          <Link to="/markets" className="btn-outline btn-outline--sm">
            Launch app
          </Link>
        </nav>
      </div>
    </header>
  )
}
