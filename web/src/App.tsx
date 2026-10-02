import { useEffect, useState } from 'react'
import { AutopsyView } from './components/AutopsyView'
import { CertificateModal } from './components/CertificateModal'
import { CostView } from './components/CostView'
import { DiffView } from './components/DiffView'
import { GameView } from './components/GameView'
import { GraphView } from './components/GraphView'
import { Header } from './components/Header'
import { Inspector } from './components/Inspector'
import { Landing } from './components/Landing'
import { PasteModal, SettingsModal, ShortcutsModal } from './components/Modals'
import { ProfileView } from './components/ProfileView'
import { ReplayView } from './components/ReplayView'
import { Timeline } from './components/Timeline'
import { Toasts } from './components/Toasts'
import { useAnalysis, useHotkeys } from './hooks'
import { useActive, useStore, TABS, type Tab } from './store'

export async function readFiles(files: FileList | File[]): Promise<void> {
  const st = useStore.getState()
  let last: string | null = null
  for (const f of Array.from(files)) {
    try {
      const text = await f.text()
      last = st.addTrace(text, f.name, 'file')
    } catch (err) {
      st.toast({
        icon: '🧟',
        title: `Couldn't read ${f.name}`,
        body: (err as Error).message,
        tone: 'error',
      })
    }
  }
  if (last) st.setTab('autopsy')
}

function useHashRouting() {
  const { tab, activeKey, traces } = useStore()
  useEffect(() => {
    const apply = () => {
      const params = new URLSearchParams(location.hash.slice(1))
      const st = useStore.getState()
      const sample = params.get('sample')
      const compare = params.get('compare')
      const t = params.get('tab') as Tab | null
      void (async () => {
        if (compare) {
          const k = await st.loadSample(compare)
          if (k) useStore.getState().setCompare(k)
        }
        if (sample) {
          const k = await st.loadSample(sample)
          if (k) useStore.getState().setActive(k)
        }
        if (t && TABS.some((x) => x.id === t)) st.setTab(t)
        else if (params.get('play')) st.setTab('game')
      })()
    }
    apply()
    // react to links / manual edits of the hash (our own updates use replaceState, which does not fire this)
    window.addEventListener('hashchange', apply)
    return () => window.removeEventListener('hashchange', apply)
  }, [])
  useEffect(() => {
    const active = traces.find((x) => x.key === activeKey)
    const p = new URLSearchParams(location.hash.slice(1))
    p.set('tab', tab)
    if (active?.sampleId) p.set('sample', active.sampleId)
    else p.delete('sample')
    history.replaceState(null, '', `#${p.toString()}`)
  }, [tab, activeKey, traces])
}

export default function App() {
  const { tab, setTab, modal, setModal, selectedSpanId, select, toggle } = useStore()
  const active = useActive()
  const analysis = useAnalysis()
  const [dragging, setDragging] = useState(false)
  useHashRouting()

  useHotkeys({
    ...Object.fromEntries(TABS.map((t) => [t.key, () => setTab(t.id)])),
    '?': () => setModal('shortcuts'),
    r: () => toggle('roast'),
    x: () => toggle('redact'),
    c: () => active && setModal('certificate'),
    p: () => setModal('paste'),
    Escape: () => (modal ? setModal(null) : select(null)),
    j: () => stepSelection(1),
    k: () => stepSelection(-1),
    ArrowDown: (e) => tab === 'timeline' && (e.preventDefault(), stepSelection(1)),
    ArrowUp: (e) => tab === 'timeline' && (e.preventDefault(), stepSelection(-1)),
  })

  function stepSelection(d: number) {
    if (!analysis) return
    const spans = analysis.trace.spans
    const i = spans.findIndex((s) => s.id === selectedSpanId)
    const next = spans[Math.max(0, Math.min(spans.length - 1, i + d))]
    if (next) select(next.id)
  }

  const showInspector =
    !!selectedSpanId &&
    !!analysis &&
    (tab === 'timeline' || tab === 'graph' || tab === 'replay' || tab === 'cost')

  return (
    <div
      className="flex min-h-full flex-col"
      onDragOver={(e) => {
        if (e.dataTransfer.types.includes('Files')) {
          e.preventDefault()
          setDragging(true)
        }
      }}
      onDragLeave={(e) => {
        if (e.currentTarget === e.target || !e.relatedTarget) setDragging(false)
      }}
      onDrop={(e) => {
        e.preventDefault()
        setDragging(false)
        if (e.dataTransfer.files.length) void readFiles(e.dataTransfer.files)
      }}
    >
      <Header />
      <main className="mx-auto flex w-full max-w-[1600px] flex-1 gap-4 px-3 pb-10 sm:px-5">
        <div className="min-w-0 flex-1">
          {tab === 'autopsy' &&
            (analysis ? <AutopsyView key={analysis.trace.id} analysis={analysis} /> : <Landing />)}
          {tab === 'timeline' &&
            (analysis ? <Timeline analysis={analysis} /> : <Landing compact />)}
          {tab === 'replay' &&
            (analysis ? <ReplayView analysis={analysis} /> : <Landing compact />)}
          {tab === 'graph' && (analysis ? <GraphView analysis={analysis} /> : <Landing compact />)}
          {tab === 'cost' && (analysis ? <CostView analysis={analysis} /> : <Landing compact />)}
          {tab === 'diff' && <DiffView />}
          {tab === 'game' && <GameView />}
          {tab === 'profile' && <ProfileView />}
        </div>
        {showInspector && <Inspector analysis={analysis} spanId={selectedSpanId} />}
      </main>
      <footer className="border-t border-white/[0.05] px-5 py-4 text-center text-xs text-slate-500">
        Agent Autopsy runs 100% in your browser — traces never leave your machine. ·{' '}
        <a
          className="text-slate-400 hover:text-white"
          href="https://github.com/gfxroy/agent-autopsy"
        >
          GitHub
        </a>{' '}
        · MIT · built by{' '}
        <a className="text-slate-400 hover:text-white" href="https://github.com/gfxroy">
          Aaditya Roy
        </a>{' '}
        · press <span className="kbd">?</span> for shortcuts
      </footer>
      {dragging && (
        <div className="pointer-events-none fixed inset-0 z-40 flex items-center justify-center bg-rose-950/40 backdrop-blur-sm">
          <div className="animate-pop rounded-2xl border-2 border-dashed border-rose-400/70 bg-ink-900/90 px-10 py-8 text-center">
            <div className="text-5xl">🩻</div>
            <div className="mt-2 text-lg font-semibold text-white">Drop the body here</div>
            <div className="text-sm text-slate-400">
              JSON / JSONL / log — format auto-detected, nothing uploaded
            </div>
          </div>
        </div>
      )}
      <Toasts />
      {modal === 'certificate' && analysis && <CertificateModal analysis={analysis} />}
      {modal === 'settings' && <SettingsModal />}
      {modal === 'shortcuts' && <ShortcutsModal />}
      {modal === 'paste' && <PasteModal />}
    </div>
  )
}
