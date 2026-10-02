import { render, screen } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'
import App from '../App'

describe('App smoke', () => {
  it('renders the landing page with samples and the daily CTA', () => {
    vi.stubGlobal('matchMedia', (q: string) => ({
      matches: false,
      media: q,
      addEventListener() {},
      removeEventListener() {},
    }))
    render(<App />)
    expect(screen.getByTestId('dropzone')).toBeInTheDocument()
    expect(screen.getByTestId('play-daily-cta')).toBeInTheDocument()
    expect(screen.getAllByTestId(/^sample-/).length).toBeGreaterThanOrEqual(10)
    expect(screen.getByText(/killed your/i)).toBeInTheDocument()
  })
})
