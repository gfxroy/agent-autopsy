import { useEffect, useMemo, useRef, useState } from 'react'
import { analyze, type Analysis } from './engine/analyze'
import { redactTrace } from './engine/redact'
import type { Trace } from './engine/types'
import { useActive, useStore } from './store'

export function useAnalysisFor(trace: Trace | undefined): Analysis | undefined {
  const prices = useStore((s) => s.prices)
  const redact = useStore((s) => s.redact)
  return useMemo(
    () => (trace ? analyze(redact ? redactTrace(trace) : trace, prices) : undefined),
    [trace, prices, redact],
  )
}

export function useAnalysis(): Analysis | undefined {
  return useAnalysisFor(useActive()?.trace)
}

/** Animated number count-up (easeOutExpo). Restarts when `key` changes. */
export function useCountUp(
  target: number,
  durationMs = 1400,
  delayMs = 0,
  key: unknown = target,
): number {
  const [v, setV] = useState(0)
  useEffect(() => {
    if (
      typeof window !== 'undefined' &&
      window.matchMedia?.('(prefers-reduced-motion: reduce)').matches
    ) {
      setV(target)
      return
    }
    let raf = 0
    const t0 = performance.now() + delayMs
    const step = (now: number) => {
      const p = Math.min(1, Math.max(0, (now - t0) / durationMs))
      const e = p === 1 ? 1 : 1 - Math.pow(2, -10 * p)
      setV(target * e)
      if (p < 1) raf = requestAnimationFrame(step)
    }
    setV(0)
    raf = requestAnimationFrame(step)
    return () => cancelAnimationFrame(raf)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [target, durationMs, delayMs, key])
  return v
}

export function useHotkeys(map: Record<string, (e: KeyboardEvent) => void>): void {
  const ref = useRef(map)
  ref.current = map
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const t = e.target as HTMLElement | null
      if (
        t &&
        (t.tagName === 'INPUT' ||
          t.tagName === 'TEXTAREA' ||
          t.tagName === 'SELECT' ||
          t.isContentEditable)
      )
        return
      if (e.metaKey || e.ctrlKey || e.altKey) return
      const fn = ref.current[e.key]
      if (fn) {
        fn(e)
      }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [])
}

/** Elapsed ms since `running` became true; freezes when false. */
export function useStopwatch(running: boolean, resetKey: unknown): number {
  const [ms, setMs] = useState(0)
  const start = useRef(0)
  useEffect(() => {
    setMs(0)
    start.current = performance.now()
  }, [resetKey])
  useEffect(() => {
    if (!running) return
    const base = performance.now() - ms
    start.current = base
    const id = setInterval(() => setMs(performance.now() - base), 100)
    return () => clearInterval(id)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [running, resetKey])
  return ms
}
