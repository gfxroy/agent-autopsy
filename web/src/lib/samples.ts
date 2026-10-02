export interface SampleDef {
  id: string
  file: string
  title: string
  blurb: string
  format: string
  emoji: string
}

export const SAMPLES: SampleDef[] = [
  {
    id: 'looping-research',
    file: 'looping-research.agents-sdk.json',
    title: 'Looping research agent',
    blurb: 'Searches the same query 5× and drags a 9k-token page through every turn.',
    format: 'OpenAI Agents SDK',
    emoji: '🔁',
  },
  {
    id: 'coding-agent',
    file: 'coding-agent.anthropic.json',
    title: 'Coding agent with tool errors',
    blurb: 'Hallucinated tool, schema-breaking write, blind test retries, then max_tokens.',
    format: 'Anthropic Messages',
    emoji: '🧑‍💻',
  },
  {
    id: 'injected-browser',
    file: 'injected-browser.otel.json',
    title: 'Prompt-injected shopping agent',
    blurb: 'A hidden HTML comment makes it email your data to an attacker.',
    format: 'OTel GenAI (OTLP)',
    emoji: '🕷️',
  },
  {
    id: 'clean-travel',
    file: 'clean-travel.openai-chat.json',
    title: 'Clean, efficient travel run',
    blurb: 'Parallel tool calls, two LLM turns, correct answer. The control group.',
    format: 'OpenAI Chat Completions',
    emoji: '✈️',
  },
  {
    id: 'refund-support',
    file: 'refund-support.responses.json',
    title: 'Refund agent invents an enum',
    blurb: 'reason="cracked_screen" is not in the schema. 422. Retry.',
    format: 'OpenAI Responses API',
    emoji: '💳',
  },
  {
    id: 'hr-agent',
    file: 'hr-agent.langsmith.json',
    title: 'LangGraph HR agent',
    blurb: 'Slow retriever returns 7k tokens that ride along for the rest of the run.',
    format: 'LangSmith runs',
    emoji: '📚',
  },
  {
    id: 'filesystem-mcp',
    file: 'filesystem.mcp.log',
    title: 'MCP filesystem session',
    blurb: 'Reads the same CSV 3×, calls a tool that does not exist, breaks a schema.',
    format: 'MCP JSON-RPC log',
    emoji: '🗂️',
  },
  {
    id: 'triage-pingpong',
    file: 'triage-pingpong.agents-sdk.jsonl',
    title: 'Multi-agent handoff ping-pong',
    blurb: 'Triage ⇄ Billing, five times, then nobody answers.',
    format: 'Agents SDK JSONL',
    emoji: '🏓',
  },
  {
    id: 'trip-planner',
    file: 'trip-planner.python-helper.jsonl',
    title: 'Trip planner (Python helper)',
    blurb: 'Recorded with the bundled agent_autopsy Python package.',
    format: 'Agent Autopsy JSONL',
    emoji: '🐍',
  },
  {
    id: 'looping-research-fixed',
    file: 'looping-research-fixed.agents-sdk.json',
    title: 'Research agent — fixed',
    blurb: 'Same task after the fix. Diff it against the looping run.',
    format: 'OpenAI Agents SDK',
    emoji: '🩹',
  },
]

export function sampleUrl(file: string): string {
  return `${import.meta.env.BASE_URL}samples/${file}`
}
