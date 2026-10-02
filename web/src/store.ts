import { create } from 'zustand'
import { persist } from 'zustand/middleware'
import { loadTrace } from './engine'
import { DEFAULT_PRICES, type PriceRow } from './engine/pricing'
import type { Trace } from './engine/types'
import { burst, setSound, sfx } from './lib/fx'
import { emptyProgress, ProgressTx, type Progress } from './lib/progress'
import { SAMPLES, sampleUrl } from './lib/samples'

export type Tab = 'autopsy' | 'timeline' | 'replay' | 'graph' | 'cost' | 'diff' | 'game' | 'profile'
export const TABS: { id: Tab; label: string; key: string; needsTrace: boolean }[] = [
  { id: 'autopsy', label: 'Autopsy', key: '1', needsTrace: false },
  { id: 'timeline', label: 'Timeline', key: '2', needsTrace: true },
  { id: 'replay', label: 'Replay', key: '3', needsTrace: true },
  { id: 'graph', label: 'Tool graph', key: '4', needsTrace: true },
  { id: 'cost', label: 'Cost & context', key: '5', needsTrace: true },
  { id: 'diff', label: 'Diff', key: '6', needsTrace: false },
  { id: 'game', label: 'Spot the Bug', key: '7', needsTrace: false },
  { id: 'profile', label: 'Profile', key: '8', needsTrace: false },
]

export interface Loaded {
  key: string
  trace: Trace
  source: 'sample' | 'file' | 'paste'
  sampleId?: string
}

export interface Toast {
  id: number
  icon: string
  title: string
  body?: string
  tone: 'xp' | 'badge' | 'rank' | 'error' | 'info'
}

type Modal = null | 'certificate' | 'settings' | 'shortcuts' | 'paste'

interface State {
  traces: Loaded[]
  activeKey: string | null
  compareKey: string | null
  tab: Tab
  selectedSpanId: string | null
  modal: Modal
  roast: boolean
  sound: boolean
  redact: boolean
  prices: PriceRow[]
  progress: Progress
  toasts: Toast[]
  loading: boolean
  addTrace(text: string, name: string, source: Loaded['source'], sampleId?: string): string
  loadSample(id: string): Promise<string | null>
  remove(key: string): void
  setActive(key: string | null): void
  setCompare(key: string | null): void
  setTab(tab: Tab): void
  select(id: string | null): void
  setModal(m: Modal): void
  toggle(k: 'roast' | 'sound' | 'redact'): void
  setPrices(p: PriceRow[]): void
  setPlayerName(name: string): void
  applyProgress(tx: ProgressTx): void
  toast(t: Omit<Toast, 'id'>): void
  dismiss(id: number): void
  resetProgress(): void
}

let toastId = 0

export const useStore = create<State>()(
  persist(
    (set, get) => ({
      traces: [],
      activeKey: null,
      compareKey: null,
      tab: 'autopsy',
      selectedSpanId: null,
      modal: null,
      roast: false,
      sound: false,
      redact: false,
      prices: DEFAULT_PRICES,
      progress: emptyProgress(),
      toasts: [],
      loading: false,
      addTrace(text, name, source, sampleId) {
        const trace = loadTrace(text, name)
        const existing = get().traces.find((t) => t.trace.id === trace.id)
        if (existing) {
          set({ activeKey: existing.key, selectedSpanId: null })
          return existing.key
        }
        const key = trace.id
        set((s) => ({
          traces: [...s.traces, { key, trace, source, sampleId }],
          activeKey: key,
          selectedSpanId: null,
        }))
        return key
      },
      async loadSample(id) {
        const def = SAMPLES.find((s) => s.id === id)
        if (!def) return null
        const loaded = get().traces.find((t) => t.sampleId === id)
        if (loaded) return loaded.key
        set({ loading: true })
        try {
          const res = await fetch(sampleUrl(def.file))
          if (!res.ok) throw new Error(`Could not fetch sample (${res.status})`)
          const text = await res.text()
          const key = get().addTrace(text, def.title, 'sample', id)
          return key
        } catch (err) {
          get().toast({
            icon: '⚠️',
            title: 'Failed to load sample',
            body: (err as Error).message,
            tone: 'error',
          })
          return null
        } finally {
          set({ loading: false })
        }
      },
      remove(key) {
        set((s) => {
          const traces = s.traces.filter((t) => t.key !== key)
          return {
            traces,
            activeKey: s.activeKey === key ? (traces[traces.length - 1]?.key ?? null) : s.activeKey,
            compareKey: s.compareKey === key ? null : s.compareKey,
          }
        })
      },
      setActive: (key) => set({ activeKey: key, selectedSpanId: null }),
      setCompare: (key) => set({ compareKey: key }),
      setTab: (tab) => set({ tab }),
      select: (id) => set({ selectedSpanId: id }),
      setModal: (modal) => set({ modal }),
      toggle(k) {
        set((s) => ({ [k]: !s[k] }) as Partial<State>)
        if (k === 'sound') setSound(get().sound)
        if (k === 'roast' && get().roast)
          get().applyProgress(new ProgressTx(get().progress).badge('roast-master'))
      },
      setPrices: (prices) => set({ prices }),
      setPlayerName: (name) =>
        set((s) => ({
          progress: {
            ...s.progress,
            playerName: name.slice(0, 24) || 'You',
            leaderboard: s.progress.leaderboard.map((e) =>
              e.bot ? e : { ...e, name: name.slice(0, 24) || 'You' },
            ),
          },
        })),
      applyProgress(tx) {
        set({ progress: tx.p })
        for (const e of tx.events) {
          if (e.type === 'xp' && !e.reason.startsWith('Badge:'))
            get().toast({ icon: '✨', title: `+${e.amount} XP`, body: e.reason, tone: 'xp' })
          if (e.type === 'badge') {
            get().toast({
              icon: e.badge.icon,
              title: `Badge unlocked: ${e.badge.name}`,
              body: `${e.badge.desc} · +150 XP`,
              tone: 'badge',
            })
            sfx.badge()
            burst({ count: 70, emoji: [e.badge.icon], y: 80, x: window.innerWidth - 180 })
          }
          if (e.type === 'rank') {
            get().toast({
              icon: e.icon,
              title: `Promoted: ${e.title}`,
              body: 'New rank unlocked',
              tone: 'rank',
            })
            burst({ count: 160 })
          }
        }
      },
      toast(t) {
        const id = ++toastId
        set((s) => ({ toasts: [...s.toasts.slice(-4), { ...t, id }] }))
        setTimeout(() => get().dismiss(id), t.tone === 'error' ? 7000 : 4200)
      },
      dismiss: (id) => set((s) => ({ toasts: s.toasts.filter((t) => t.id !== id) })),
      resetProgress: () => set({ progress: emptyProgress() }),
    }),
    {
      name: 'agent-autopsy:v1',
      partialize: (s) => ({
        roast: s.roast,
        sound: s.sound,
        redact: s.redact,
        prices: s.prices,
        progress: s.progress,
      }),
      onRehydrateStorage: () => (s) => {
        if (s) setSound(s.sound)
      },
    },
  ),
)

export function useActive(): Loaded | undefined {
  return useStore((s) => s.traces.find((t) => t.key === s.activeKey))
}
