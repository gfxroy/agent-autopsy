import clsx from 'clsx'
import { useStore } from '../store'

export function Toasts() {
  const { toasts, dismiss } = useStore()
  return (
    <div
      className="pointer-events-none fixed right-3 bottom-3 z-[60] flex w-64 flex-col gap-1.5 sm:w-80 sm:gap-2"
      aria-live="polite"
    >
      {toasts.map((t, i) => (
        <button
          key={t.id}
          onClick={() => dismiss(t.id)}
          className={clsx(
            'pointer-events-auto flex animate-slide-in items-start gap-2 rounded-xl border px-2.5 py-1.5 text-left shadow-2xl backdrop-blur sm:gap-3 sm:px-3 sm:py-2.5',
            i < toasts.length - 3 && 'max-sm:hidden',
            t.tone === 'badge' && 'border-amber-400/40 bg-amber-950/80',
            t.tone === 'rank' && 'border-fuchsia-400/40 bg-fuchsia-950/80',
            t.tone === 'xp' && 'border-cyan-400/25 bg-ink-800/95',
            t.tone === 'error' && 'border-rose-500/40 bg-rose-950/85',
            t.tone === 'info' && 'border-white/10 bg-ink-800/95',
          )}
        >
          <span className="text-lg leading-none sm:text-xl">{t.icon}</span>
          <span className="min-w-0">
            <span className="block text-sm font-semibold text-white">{t.title}</span>
            {t.body && <span className="block text-xs text-slate-300 max-sm:hidden">{t.body}</span>}
          </span>
        </button>
      ))}
    </div>
  )
}
