import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import App from './App'
import { analyze, loadTrace } from './engine'
import { plainReport } from './lib/plain'
import './index.css'

// Console API for power users: `agentAutopsy.report(text)`.
Object.assign(window, {
  agentAutopsy: {
    loadTrace,
    analyze,
    report: (text: string) => plainReport(analyze(loadTrace(text))),
  },
})

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <App />
  </StrictMode>,
)
