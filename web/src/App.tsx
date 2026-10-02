import { useEffect, useState } from 'react'
import { Examine } from './components/Examine'
import { Landing } from './components/Landing'

type Route = { page: 'home' } | { page: 'examine'; sample?: string }

function parse(hash: string): Route {
  const h = hash.replace(/^#\/?/, '')
  if (!h.startsWith('examine')) return { page: 'home' }
  const q = new URLSearchParams(h.split('?')[1] ?? '')
  return { page: 'examine', sample: q.get('sample') ?? undefined }
}

export default function App() {
  const [route, setRoute] = useState<Route>(() => parse(location.hash))
  useEffect(() => {
    const on = () => {
      setRoute(parse(location.hash))
      window.scrollTo(0, 0)
    }
    window.addEventListener('hashchange', on)
    return () => window.removeEventListener('hashchange', on)
  }, [])

  return (
    <div className="flex min-h-screen flex-col">
      <header className="border-b border-neutral-200">
        <div className="wrap flex h-14 items-center justify-between">
          <a
            href="#/"
            className="text-[15px] font-semibold tracking-tight"
            aria-label="Agent Autopsy home"
          >
            Agent Autopsy
          </a>
          <nav className="flex items-center gap-5 text-sm">
            <a href="#/examine" className="link">
              Examine
            </a>
            <a
              href="https://github.com/gfxroy/agent-autopsy"
              className="link"
              target="_blank"
              rel="noreferrer"
            >
              GitHub
            </a>
          </nav>
        </div>
      </header>
      <main className="flex-1">
        {route.page === 'home' ? (
          <Landing />
        ) : (
          <Examine key={route.sample ?? ''} sample={route.sample} />
        )}
      </main>
      <footer className="border-t border-neutral-200">
        <div className="wrap flex flex-col gap-2 py-8 text-sm text-neutral-500 sm:flex-row sm:items-center sm:justify-between">
          <span>Agent Autopsy · Runs in your browser. Nothing is uploaded.</span>
          <span className="flex gap-5">
            <a
              href="https://github.com/gfxroy/agent-autopsy"
              className="link"
              target="_blank"
              rel="noreferrer"
            >
              Source
            </a>
            <a
              href="https://github.com/gfxroy/agent-autopsy/blob/main/LICENSE"
              className="link"
              target="_blank"
              rel="noreferrer"
            >
              MIT License
            </a>
          </span>
        </div>
      </footer>
    </div>
  )
}
