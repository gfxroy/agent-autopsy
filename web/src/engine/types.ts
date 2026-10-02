/** The one internal span model every importer normalizes into. */

export type SpanKind =
  'agent' | 'llm' | 'tool' | 'retrieval' | 'handoff' | 'guardrail' | 'chain' | 'other'

export type Role = 'system' | 'user' | 'assistant' | 'tool'

export interface ToolCall {
  id: string
  name: string
  /** Parsed arguments (undefined when `argsRaw` is not valid JSON). */
  args?: unknown
  argsRaw: string
}

export interface Message {
  role: Role
  content: string
  toolCalls?: ToolCall[]
  toolCallId?: string
  name?: string
  isError?: boolean
}

export interface ToolDef {
  name: string
  description?: string
  parameters?: JsonSchema
}

export interface JsonSchema {
  type?: string | string[]
  properties?: Record<string, JsonSchema>
  required?: string[]
  enum?: unknown[]
  items?: JsonSchema
  additionalProperties?: boolean | JsonSchema
  description?: string
  [k: string]: unknown
}

export interface Span {
  id: string
  parentId?: string
  kind: SpanKind
  name: string
  /** Milliseconds since epoch (or since trace start when timing is synthetic). */
  start: number
  end: number
  status: 'ok' | 'error'
  error?: string

  // LLM
  model?: string
  provider?: string
  inputTokens?: number
  outputTokens?: number
  cachedTokens?: number
  /** True when token counts were estimated from text length. */
  tokensEstimated?: boolean
  input?: Message[]
  output?: Message[]
  finishReason?: string

  // Tool
  toolName?: string
  toolCallId?: string
  toolArgs?: unknown
  toolArgsRaw?: string
  toolResult?: string

  agentName?: string
  attributes: Record<string, unknown>

  // Filled by the normalizer
  depth?: number
  index?: number
}

export type FormatId =
  | 'openai-chat'
  | 'openai-responses'
  | 'openai-agents'
  | 'anthropic'
  | 'langsmith'
  | 'otel'
  | 'mcp'
  | 'jsonl'

export interface Trace {
  id: string
  name: string
  format: FormatId
  spans: Span[]
  tools: ToolDef[]
  /** Final answer text the agent produced, if any. */
  finalOutput?: string
  /** True when span timings were synthesized (message arrays carry no timestamps). */
  timingEstimated: boolean
  meta: Record<string, unknown>
}

export type Severity = 'critical' | 'high' | 'medium' | 'low' | 'info'

export type RuleId =
  | 'loop'
  | 'tool-error'
  | 'unknown-tool'
  | 'invalid-args'
  | 'context-bloat'
  | 'context-overflow'
  | 'prompt-injection'
  | 'no-final-answer'
  | 'truncated-output'
  | 'slow-step'
  | 'expensive-step'
  | 'unused-tools'
  | 'handoff-pingpong'

export interface Finding {
  rule: RuleId
  severity: Severity
  title: string
  detail: string
  fix: string
  /** First span is the "smoking gun" — where the problem originates. */
  spanIds: string[]
  wastedTokens?: number
  wastedUsd?: number
  /** Tokens wasted, attributed per LLM span (used to dedupe totals across findings). */
  wasteBySpan?: Record<string, number>
  /** Short dramatic label used as "cause of death". */
  cause: string
  /** Values for roast templates. */
  vars?: Record<string, string | number>
}
