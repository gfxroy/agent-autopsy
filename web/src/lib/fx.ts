/** Confetti/particles and optional (off by default) WebAudio sound effects. */

let canvas: HTMLCanvasElement | null = null
interface P {
  x: number
  y: number
  vx: number
  vy: number
  life: number
  color: string
  size: number
  rot: number
  vr: number
  shape: 'rect' | 'circle' | 'emoji'
  emoji?: string
}
let parts: P[] = []
let raf = 0

function ensureCanvas(): CanvasRenderingContext2D | null {
  if (typeof document === 'undefined') return null
  if (!canvas) {
    canvas = document.createElement('canvas')
    canvas.style.cssText = 'position:fixed;inset:0;pointer-events:none;z-index:100'
    canvas.setAttribute('aria-hidden', 'true')
    document.body.appendChild(canvas)
  }
  canvas.width = window.innerWidth
  canvas.height = window.innerHeight
  return canvas.getContext('2d')
}

function loop() {
  const ctx = canvas?.getContext('2d')
  if (!ctx || !canvas) return
  ctx.clearRect(0, 0, canvas.width, canvas.height)
  parts = parts.filter((p) => p.life > 0)
  for (const p of parts) {
    p.x += p.vx
    p.y += p.vy
    p.vy += 0.18
    p.vx *= 0.99
    p.rot += p.vr
    p.life -= 1
    ctx.save()
    ctx.globalAlpha = Math.min(1, p.life / 40)
    ctx.translate(p.x, p.y)
    ctx.rotate(p.rot)
    if (p.shape === 'emoji') {
      ctx.font = `${p.size * 3}px serif`
      ctx.fillText(p.emoji!, 0, 0)
    } else {
      ctx.fillStyle = p.color
      if (p.shape === 'rect') ctx.fillRect(-p.size / 2, -p.size / 4, p.size, p.size / 2)
      else {
        ctx.beginPath()
        ctx.arc(0, 0, p.size / 2, 0, Math.PI * 2)
        ctx.fill()
      }
    }
    ctx.restore()
  }
  if (parts.length) raf = requestAnimationFrame(loop)
  else ctx.clearRect(0, 0, canvas.width, canvas.height)
}

export function burst(
  opts: {
    x?: number
    y?: number
    count?: number
    colors?: string[]
    emoji?: string[]
    spread?: number
  } = {},
): void {
  if (
    typeof window === 'undefined' ||
    window.matchMedia?.('(prefers-reduced-motion: reduce)').matches
  )
    return
  const ctx = ensureCanvas()
  if (!ctx) return
  const x = opts.x ?? window.innerWidth / 2
  const y = opts.y ?? window.innerHeight / 3
  const colors = opts.colors ?? ['#f43f5e', '#a78bfa', '#22d3ee', '#fbbf24', '#34d399']
  const n = opts.count ?? 120
  for (let i = 0; i < n; i++) {
    const a = Math.random() * Math.PI * 2
    const s = 3 + Math.random() * (opts.spread ?? 9)
    const useEmoji = opts.emoji && Math.random() < 0.15
    parts.push({
      x,
      y,
      vx: Math.cos(a) * s,
      vy: Math.sin(a) * s - 4,
      life: 70 + Math.random() * 60,
      color: colors[i % colors.length],
      size: 6 + Math.random() * 6,
      rot: Math.random() * 6,
      vr: (Math.random() - 0.5) * 0.3,
      shape: useEmoji ? 'emoji' : Math.random() < 0.6 ? 'rect' : 'circle',
      emoji: useEmoji ? opts.emoji![i % opts.emoji!.length] : undefined,
    })
  }
  cancelAnimationFrame(raf)
  raf = requestAnimationFrame(loop)
}

let audio: AudioContext | null = null
let enabled = false
export function setSound(on: boolean): void {
  enabled = on
}

function tone(
  freq: number,
  dur: number,
  type: OscillatorType = 'sine',
  delay = 0,
  vol = 0.06,
): void {
  if (!enabled || typeof window === 'undefined') return
  try {
    audio ??= new AudioContext()
    const o = audio.createOscillator()
    const g = audio.createGain()
    o.type = type
    o.frequency.value = freq
    g.gain.setValueAtTime(vol, audio.currentTime + delay)
    g.gain.exponentialRampToValueAtTime(0.0001, audio.currentTime + delay + dur)
    o.connect(g).connect(audio.destination)
    o.start(audio.currentTime + delay)
    o.stop(audio.currentTime + delay + dur)
  } catch {
    /* audio unavailable */
  }
}

export const sfx = {
  success: () => [523, 659, 784, 1047].forEach((f, i) => tone(f, 0.18, 'triangle', i * 0.07)),
  fail: () => [220, 160].forEach((f, i) => tone(f, 0.25, 'sawtooth', i * 0.12, 0.04)),
  tick: () => tone(1200, 0.03, 'square', 0, 0.02),
  badge: () => [784, 988, 1319].forEach((f, i) => tone(f, 0.22, 'sine', i * 0.09)),
  thud: () => tone(70, 0.4, 'sine', 0, 0.12),
}
