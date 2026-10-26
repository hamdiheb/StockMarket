import Hero from '../components/home/Hero'
import Navbar from '../components/home/Navbar'
import Pricing from '../components/home/Pricing'
import Products from '../components/home/Products'
import SiteFooter from '../components/home/SiteFooter'
import { CoinIcon, CurrencyIcon, StarIcon, StockIcon } from '../components/Icons'
import '../App.css'
import './Home.css'

const PRODUCTS = [
  { title: 'Live stocks', icon: StockIcon, text: 'US equities streamed from Alpaca with intraday charts, market status and a personal watchlist.' },
  { title: 'Currencies', icon: CurrencyIcon, text: 'Major and regional FX pairs with 24h change, powered by Twelve Data and Finnhub live updates.' },
  { title: 'Crypto', icon: CoinIcon, text: 'Top digital assets priced in USD, ticking in real time around the clock.' },
  { title: 'AI signals', icon: StarIcon, text: 'On-demand chart analysis with entry, stop-loss and targets — plus auto-watch alerts with sound.' },
]

const PLANS = [
  {
    name: 'Free',
    price: 0,
    blurb: 'Explore the markets.',
    features: ['Stocks, FX and crypto prices', 'Interactive charts', 'Watchlist up to 10 symbols', '5 AI analyses per day'],
    cta: 'Start free',
  },
  {
    name: 'Pro',
    price: 19,
    blurb: 'For active traders.',
    features: ['Everything in Free', 'Unlimited watchlist', 'Unlimited AI analyses', 'AI auto-watch alerts', 'Sound notifications'],
    cta: 'Go Pro',
    popular: true,
  },
  {
    name: 'Team',
    price: 49,
    blurb: 'For desks and small funds.',
    features: ['Everything in Pro', 'Up to 5 seats', 'Shared watchlists', 'Priority data refresh', 'Email support'],
    cta: 'Start with Team',
  },
]

export default function Home() {
  return (
    <div className="home">
      <Navbar />
      <main>
        <Hero />
        <Products products={PRODUCTS} />
        <Pricing plans={PLANS} />
      </main>
      <SiteFooter />
    </div>
  )
}
