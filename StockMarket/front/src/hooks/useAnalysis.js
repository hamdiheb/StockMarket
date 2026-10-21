import { useCallback, useEffect, useRef, useState } from 'react'
import { fetchAnalysis } from '../lib/api'
import { playSignal, unlockAudio } from '../lib/sound'

const AUTO_INTERVAL_MS = 15 * 60e3
const SIGNAL_TTL_MS = 60 * 60e3 // badges disappear once a signal is this old
const TOAST_MS = 20e3
const AUTO_KEY = 'stockmarket.autowatch'
const LAST_KEY = 'stockmarket.lastSignals'

function load(key, fallback) {
  try {
    return JSON.parse(localStorage.getItem(key)) ?? fallback
  } catch {
    return fallback
  }
}

function save(key, value) {
  try {
    localStorage.setItem(key, JSON.stringify(value))
  } catch {
    // storage unavailable: keep in-memory only
  }
}

function browserNotify(data) {
  if (typeof Notification === 'undefined' || Notification.permission !== 'granted') return
  try {
    const n = new Notification(`${data.signal} ${data.symbol}`, {
      body: `Entry ${data.entry} · stop ${data.stopLoss} · target ${data.takeProfit} (${data.confidence}% confidence)`,
      tag: `signal-${data.symbol}`,
    })
    n.onclick = () => window.focus()
  } catch {
    // some browsers only allow notifications from a service worker
  }
}

// An actionable BUY/SELL that's recent enough to show as a badge, or null.
export function activeSignal(result) {
  const data = result?.data
  if (!data?.actionable) return null
  return Date.now() - Date.parse(data.generatedAt) < SIGNAL_TTL_MS ? data : null
}

// AI signals per symbol. analyze() runs on demand; auto-watch re-checks the watchlist every 15 minutes.
// Sound, toast and browser notification fire only for an actionable signal that differs from the
// symbol's previous signal — "stand aside" results never notify.
export function useAnalysis(bySymbol, watchlist) {
  const [results, setResults] = useState({}) // symbol -> { data, loading, error }
  const [toasts, setToasts] = useState([])
  const [autoWatch, setAutoWatchState] = useState(() => load(AUTO_KEY, false))
  const lastSignals = useRef(load(LAST_KEY, {}))

  // The auto-watch loop reads these through refs so price updates don't restart it.
  const assetsRef = useRef(bySymbol)
  const watchRef = useRef(watchlist)
  useEffect(() => {
    assetsRef.current = bySymbol
    watchRef.current = watchlist
  })

  const dismissToast = useCallback((id) => setToasts((prev) => prev.filter((t) => t.id !== id)), [])

  const analyze = useCallback(
    async (asset, { auto = false } = {}) => {
      const { symbol } = asset
      if (!auto) unlockAudio()
      setResults((prev) => ({ ...prev, [symbol]: { ...prev[symbol], loading: true, error: null } }))
      try {
        const data = await fetchAnalysis(asset)
        setResults((prev) => ({ ...prev, [symbol]: { data, loading: false, error: null } }))

        const changed = data.signal !== lastSignals.current[symbol]
        lastSignals.current = { ...lastSignals.current, [symbol]: data.signal }
        save(LAST_KEY, lastSignals.current)
        if (!data.actionable) return

        // On demand the user is looking at the result: just the sound. In the background: the full alert, once.
        if (!auto) playSignal(data.signal)
        else if (changed) {
          playSignal(data.signal)
          browserNotify(data)
          const id = `${symbol}-${data.generatedAt}`
          setToasts((prev) => [...prev.filter((t) => t.symbol !== symbol), { id, symbol, data }])
          setTimeout(() => dismissToast(id), TOAST_MS)
        }
      } catch (err) {
        setResults((prev) => ({ ...prev, [symbol]: { ...prev[symbol], loading: false, error: err.message } }))
      }
    },
    [dismissToast],
  )

  const setAutoWatch = useCallback((on) => {
    if (on) {
      unlockAudio()
      if (typeof Notification !== 'undefined' && Notification.permission === 'default') Notification.requestPermission()
    }
    setAutoWatchState(on)
    save(AUTO_KEY, on)
  }, [])

  // Sweep the watchlist one symbol at a time (the model is the bottleneck), then wait.
  const ready = Object.keys(bySymbol).length > 0
  useEffect(() => {
    if (!autoWatch || !ready) return
    let cancelled = false
    let timer
    async function sweep() {
      for (const symbol of watchRef.current) {
        if (cancelled) return
        const asset = assetsRef.current[symbol]
        if (asset) await analyze(asset, { auto: true })
      }
      if (!cancelled) timer = setTimeout(sweep, AUTO_INTERVAL_MS)
    }
    sweep()
    return () => {
      cancelled = true
      clearTimeout(timer)
    }
  }, [autoWatch, ready, analyze])

  return { results, analyze, autoWatch, setAutoWatch, toasts, dismissToast }
}
