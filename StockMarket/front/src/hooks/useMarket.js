import { useCallback, useEffect, useState } from 'react'
import { ASSETS, gaussian, generateCandles } from '../data/markets'

const TICK_MS = 1600

function initialQuotes() {
  const quotes = {}
  for (const asset of ASSETS) {
    const day = generateCandles(asset, '1D')
    quotes[asset.symbol] = {
      price: asset.price,
      open: day[0].o,
      high: Math.max(...day.map((c) => c.h)),
      low: Math.min(...day.map((c) => c.l)),
      volume: day.reduce((sum, c) => sum + c.v, 0),
      spark: day.filter((_, i) => i % 2 === 1).map((c) => c.c),
      dir: 0,
      tick: 0,
    }
  }
  return quotes
}

// Simulated live feed: a random subset of instruments moves on every tick.
export function useMarket() {
  const [quotes, setQuotes] = useState(initialQuotes)

  useEffect(() => {
    const id = setInterval(() => {
      setQuotes((prev) => {
        const next = { ...prev }
        for (const asset of ASSETS) {
          if (Math.random() > 0.45) continue
          const q = prev[asset.symbol]
          const price = q.price * Math.exp(gaussian() * asset.vol * 0.025)
          next[asset.symbol] = {
            ...q,
            price,
            high: Math.max(q.high, price),
            low: Math.min(q.low, price),
            volume: q.volume + asset.adv * 0.0004 * Math.random(),
            spark: [...q.spark.slice(1), price],
            dir: price >= q.price ? 1 : -1,
            tick: q.tick + 1,
          }
        }
        return next
      })
    }, TICK_MS)
    return () => clearInterval(id)
  }, [])

  return quotes
}

const WATCH_KEY = 'stockmarket.watchlist'

export function useWatchlist() {
  const [list, setList] = useState(() => {
    try {
      return JSON.parse(localStorage.getItem(WATCH_KEY)) ?? ['NVDA', 'BTC', 'EUR/USD']
    } catch {
      return ['NVDA', 'BTC', 'EUR/USD']
    }
  })

  const toggle = useCallback((symbol) => {
    setList((prev) => {
      const next = prev.includes(symbol) ? prev.filter((s) => s !== symbol) : [...prev, symbol]
      try {
        localStorage.setItem(WATCH_KEY, JSON.stringify(next))
      } catch {
        // storage unavailable: keep in-memory only
      }
      return next
    })
  }, [])

  return [list, toggle]
}
