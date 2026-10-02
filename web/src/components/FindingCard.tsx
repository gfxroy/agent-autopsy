import clsx from 'clsx'
import type { Finding } from '../engine/types'
import { roastFinding } from '../engine/roast'
import { fmtNum, fmtUsd } from '../engine/util'
import { useStore } from '../store'
import { Md, SEV_DOT, SeverityPill } from './ui'

export function FindingCard({
  f,
  seed,
  index = 0,
  killer,
}: {
  f: Finding
  seed: string
  index?: number
  killer?: boolean
}) {
  const { roast, select, setTab } = useStore()
  return (
    <article
      className={clsx(
        'relative animate-fade-in overflow-hidden panel p-4',
        killer && '!border-rose-500/40',
      )}
      style={{ animationDelay: `${index * 70}ms` }}
      data-testid="finding"
      data-rule={f.rule}
    >
      <span className={clsx('absolute inset-y-0 left-0 w-1', SEV_DOT[f.severity])} />
      <div className="flex flex-wrap items-center gap-2">
        <SeverityPill severity={f.severity} />
        {killer && (
          <span className="rounded bg-rose-600 px-1.5 py-px font-mono text-[10px] font-bold text-white">
            ☠ KILLER
          </span>
        )}
        <h3 className="min-w-0 flex-1 text-[15px] font-semibold text-white">
          <Md text={f.title} />
        </h3>
        {(f.wastedTokens ?? 0) > 0 && (
          <span className="chip !text-rose-200" title="Estimated waste">
            −{fmtNum(f.wastedTokens ?? 0)} tok · {fmtUsd(f.wastedUsd ?? 0)}
          </span>
        )}
      </div>
      {roast && (
        <p className="mt-2 rounded-lg border border-orange-400/20 bg-orange-500/[0.07] px-3 py-2 text-sm text-orange-100 italic">
          🌶️ <Md text={roastFinding(f, seed)} />
        </p>
      )}
      <p className="mt-2 text-sm text-slate-300">
        <Md text={f.detail} />
      </p>
      <p className="mt-2 text-sm text-emerald-200/90">
        <span className="font-semibold text-emerald-300">Fix → </span>
        {f.fix}
      </p>
      {f.spanIds.length > 0 && (
        <div className="mt-3 flex flex-wrap gap-1.5">
          <button
            className="btn-ghost !py-1 !text-xs"
            onClick={() => {
              select(f.spanIds[0])
              setTab('timeline')
            }}
          >
            🔎 Show in timeline{' '}
            {f.spanIds.length > 1 && (
              <span className="text-slate-500">({f.spanIds.length} spans)</span>
            )}
          </button>
        </div>
      )}
    </article>
  )
}
