import { act, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import App from '../App'
import { readSample } from './helpers'

vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockReturnValue(null)

afterEach(() => {
  history.replaceState(null, '', '#/')
  vi.unstubAllGlobals()
})

describe('App', () => {
  it('landing: headline, one primary button, how it works, formats, python snippet, privacy line', () => {
    render(<App />)
    expect(screen.getByRole('heading', { level: 1 })).toHaveTextContent(
      'Find out why your AI agent failed.',
    )
    expect(screen.getByTestId('cta')).toHaveTextContent('Examine a log')
    for (const s of ['Drop a log', 'Get the cause', 'Fix it'])
      expect(screen.getByText(s)).toBeInTheDocument()
    expect(screen.getByTestId('works-with')).toHaveTextContent(
      'Works with OpenAI, Anthropic, LangChain, OpenTelemetry, MCP.',
    )
    expect(screen.getByTestId('python-snippet')).toHaveTextContent('@rec.tool_fn')
    expect(
      screen.getAllByText(/Runs in your browser\. Nothing is uploaded\./).length,
    ).toBeGreaterThan(0)
    expect(document.body.textContent).not.toMatch(/Spot the Bug|streak|XP\b|level/i)
  })

  it('examine: a pasted log produces the report', async () => {
    history.replaceState(null, '', '#/examine')
    render(<App />)
    fireEvent.change(screen.getByTestId('paste-input'), {
      target: { value: readSample('clean-travel.openai-chat.json') },
    })
    fireEvent.click(screen.getByTestId('paste-submit'))
    expect(await screen.findByTestId('report')).toBeInTheDocument()
    expect(screen.getByTestId('grade')).toHaveTextContent('A+')
    expect(screen.getByTestId('cause')).toHaveTextContent('Nothing went wrong.')
    expect(screen.getByTestId('copy-report')).toBeInTheDocument()
    expect(screen.getByTestId('download-certificate')).toBeInTheDocument()
  })

  it('examine: a sample from the URL is loaded and the failing step is marked', async () => {
    vi.stubGlobal('fetch', async () => new Response(readSample('looping-research.agents-sdk.json')))
    history.replaceState(null, '', '#/examine?sample=looping-research')
    render(<App />)
    await waitFor(() => expect(screen.getByTestId('report')).toBeInTheDocument())
    expect(screen.getByTestId('grade')).toHaveTextContent('F')
    expect(screen.getByTestId('cause')).toHaveTextContent('stuck in a loop')
    expect(
      screen
        .getAllByTestId('step')
        .some((s) => s.dataset.failed === 'true' && s.textContent?.includes('✕')),
    ).toBe(true)
    expect(screen.getByTestId('fixes').querySelectorAll('li').length).toBeGreaterThanOrEqual(1)
  })

  it('examine: unreadable input shows a friendly error', async () => {
    history.replaceState(null, '', '#/examine')
    render(<App />)
    fireEvent.change(screen.getByTestId('paste-input'), { target: { value: '{"hello":"world"}' } })
    await act(async () => fireEvent.click(screen.getByTestId('paste-submit')))
    expect(screen.getByTestId('error')).toHaveTextContent('We couldn’t read that log.')
  })
})
