export interface SampleDef {
  id: string
  file: string
  title: string
  blurb: string
}

/** The three sample logs offered on the examine page (more live in public/samples for tests). */
export const SAMPLES: SampleDef[] = [
  {
    id: 'looping-research',
    file: 'looping-research.agents-sdk.json',
    title: 'Research agent stuck in a loop',
    blurb: 'OpenAI Agents SDK',
  },
  {
    id: 'coding-agent',
    file: 'coding-agent.anthropic.json',
    title: 'Coding agent using a tool that doesn’t exist',
    blurb: 'Anthropic',
  },
  {
    id: 'injected-browser',
    file: 'injected-browser.otel.json',
    title: 'Shopping agent hijacked by a web page',
    blurb: 'OpenTelemetry',
  },
]

export const sampleUrl = (file: string) => `${import.meta.env.BASE_URL}samples/${file}`
