import { Link } from 'react-router-dom'

const COLUMNS = [
  { title: 'Product', links: [{ label: 'Markets', to: '/markets' }, { label: 'Features', href: '#product' }, { label: 'Pricing', href: '#pricing' }] },
  { title: 'Company', links: [{ label: 'About', href: '#' }, { label: 'Contact', href: '#' }] },
  { title: 'Legal', links: [{ label: 'Terms', href: '#' }, { label: 'Privacy', href: '#' }] },
]

const YEAR = new Date().getFullYear()

export default function SiteFooter() {
  return (
    <footer className="site-footer">
      <div className="home__container site-footer__inner">
        <div className="site-footer__brand">
          <span className="rail__logo mono" aria-hidden="true">SM</span>
          <p className="fog">Live markets and AI trading signals in one terminal.</p>
        </div>
        {COLUMNS.map((col) => (
          <nav key={col.title} className="site-footer__col" aria-label={col.title}>
            <h3 className="label">{col.title}</h3>
            <ul>
              {col.links.map((l) => (
                <li key={l.label}>
                  {l.to ? <Link to={l.to}>{l.label}</Link> : <a href={l.href}>{l.label}</a>}
                </li>
              ))}
            </ul>
          </nav>
        ))}
      </div>
      <div className="home__container site-footer__bottom caption fog">
        <span>© {YEAR} StockMarket. All rights reserved.</span>
        <span>Market data is for informational purposes only and is not investment advice.</span>
      </div>
    </footer>
  )
}
