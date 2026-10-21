// Alert tones generated with the Web Audio API (no audio files). Browsers only allow sound after
// the user has interacted with the page; clicking Analyze or the auto-watch toggle counts.
let ctx

function audio() {
  ctx ??= new AudioContext()
  if (ctx.state === 'suspended') ctx.resume()
  return ctx
}

// Rising two notes for BUY, falling for SELL.
const NOTES = { BUY: [660, 990], SELL: [990, 660] }

export function playSignal(signal) {
  const notes = NOTES[signal]
  if (!notes) return
  try {
    const ac = audio()
    notes.forEach((freq, i) => {
      const start = ac.currentTime + i * 0.18
      const osc = ac.createOscillator()
      const gain = ac.createGain()
      osc.type = 'sine'
      osc.frequency.value = freq
      gain.gain.setValueAtTime(0.0001, start)
      gain.gain.exponentialRampToValueAtTime(0.25, start + 0.02)
      gain.gain.exponentialRampToValueAtTime(0.0001, start + 0.16)
      osc.connect(gain).connect(ac.destination)
      osc.start(start)
      osc.stop(start + 0.17)
    })
  } catch {
    // audio unavailable: the toast still shows
  }
}

// Call from a click handler so later alerts are allowed to play.
export function unlockAudio() {
  try {
    audio()
  } catch {
    // ignore
  }
}
