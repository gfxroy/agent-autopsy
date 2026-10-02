import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import App from './App'
import { analyze, loadTrace } from './engine'
import { buildLevel, CAMPAIGN, dailyPuzzle } from './game/levels'
import './index.css'

// Small console API for power users and end-to-end tests: `agentAutopsy.analyze(agentAutopsy.loadTrace(text))`.
Object.assign(window, {
  agentAutopsy: { loadTrace, analyze, buildLevel, dailyPuzzle, campaign: CAMPAIGN },
})

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <App />
  </StrictMode>,
)
