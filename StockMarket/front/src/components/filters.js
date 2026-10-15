import { CoinIcon, CurrencyIcon, GridIcon, StarIcon, StockIcon } from './Icons'

export const FILTERS = [
  { id: 'all', label: 'All markets', icon: GridIcon },
  { id: 'stock', label: 'Stocks', icon: StockIcon },
  { id: 'forex', label: 'Currencies', icon: CurrencyIcon },
  { id: 'crypto', label: 'Crypto', icon: CoinIcon },
  { id: 'watch', label: 'Watchlist', icon: StarIcon },
]
