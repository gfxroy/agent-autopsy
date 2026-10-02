/**
 * Turns an engine Analysis into the plain-English report shown on screen:
 * grade, one-sentence cause of death, a step list with the failing step marked, and 1–3 fixes.
 */
import type { Analysis } from '../engine/analyze'
import { FORMAT_LABELS } from '../engine/importers'
import { redactText } from '../engine/redact'
import type { Finding, Span } from '../engine/types'
import { fmtMs, fmtUsd } from '../engine/util'

export interface PlainStep {
  id: string
  n: number
  text: string
  detail?: string
  failed: boolean
}

export interface PlainReport {
  name: string
  grade: string
  status: 'healthy' | 'problems' | 'failed'
  statusLabel: string
  cause: string
  steps: PlainStep[]
  failedStep?: number
  fixes: string[]
  facts: string
  format: string
}

const tick = (s: string) => s.replace(/`/g, '')
const quote = (s: string, max = 70) => {
  const t = s
    .replace(/\*\*|__|`/g, '')
    .replace(/\s+/g, ' ')
    .trim()
  return `“${t.length > max ? `${t.slice(0, max - 1)}…` : t}”`
}
/** The most informative line of an error / failing tool output, shortened. */
export function errorSummary(text: string | undefined, max = 110): string | undefined {
  if (!text) return undefined
  const lines = text
    .split(/\r?\n/)
    .map((l) => l.trim())
    .filter((l) => l && !/^[=_-]{4,}/.test(l))
  const hit =
    [...lines]
      .reverse()
      .find((l) =>
        /(error|exception|failed|unknown|invalid|timed? ?out|denied|not found|refused|missing)/i.test(
          l,
        ),
      ) ?? lines[0]
  if (!hit) return undefined
  const t = hit.replace(/^E\s+/, '').replace(/\s+/g, ' ')
  return t.length > max ? `${t.slice(0, max - 1)}…` : t
}

const human = (name: string) =>
  /^transfer_to_/i.test(name)
    ? `hand the task to ${name.replace(/^transfer_to_/i, '').replace(/_/g, ' ')}`
    : name

const times = (n: number) => (n === 1 ? 'once' : n === 2 ? 'twice' : `${n} times`)
const words = (tokens: string | number) => {
  const n =
    typeof tokens === 'number'
      ? tokens
      : Number(String(tokens).replace(/[^\d.]/g, '')) * (/k$/i.test(String(tokens)) ? 1000 : 1)
  return Math.round((n * 0.75) / 100) * 100
}

/** One sentence: why the agent failed (or that it didn't). */
export function causeSentence(a: Analysis): string {
  const k = a.verdict.killer
  if (!k || a.verdict.status === 'alive')
    return 'Nothing went wrong. The agent finished the task cleanly.'
  return findingSentence(k)
}

export function findingSentence(f: Finding): string {
  const v = (f.vars ?? {}) as Record<string, string | number>
  const tool = tick(String(v.tool ?? 'a tool'))
  switch (f.rule) {
    case 'loop':
      return f.cause?.startsWith('Going in circles')
        ? `The agent went in circles, calling ${tool} ${times(Number(v.n))} with slightly reworded input and getting nowhere.`
        : `The agent got stuck in a loop, calling ${tool} ${times(Number(v.n))} with exactly the same input.`
    case 'tool-error':
      return f.cause?.startsWith('Wounded')
        ? `The ${tool} tool failed ${times(Number(v.n))}. The agent recovered, but it wasted time and money.`
        : `The ${tool} tool kept failing and the agent never recovered.`
    case 'unknown-tool':
      return `The agent tried to use a tool called “${tool}” that doesn't exist${v.near && v.near !== 'nothing' ? ` (it probably meant “${tick(String(v.near))}”)` : ''}.`
    case 'invalid-args':
      return f.cause?.startsWith('Schema')
        ? `The agent made up a value that the ${tool} tool doesn't accept, so the call was wrong.`
        : `The agent sent the ${tool} tool input in the wrong shape, so the call couldn't work as intended.`
    case 'prompt-injection':
      return v.action && v.action !== 'nothing (yet)'
        ? `A ${tool} result contained hidden instructions, and the agent obeyed them by calling ${tick(String(v.action))}.`
        : `A ${tool} result contained hidden instructions aimed at the agent. It didn't act on them, but it read them.`
    case 'context-bloat':
      return `One ${tool} result was huge (about ${words(v.tokens ?? 0).toLocaleString()} words) and was re-sent on every later step, wasting money.`
    case 'context-overflow':
      return v.pct !== undefined
        ? `The conversation filled ${v.pct}% of the model's memory, so earlier details were at risk of being forgotten.`
        : `The conversation kept growing every step until it was ${v.n}× its starting size.`
    case 'no-final-answer':
      return f.cause?.startsWith('Gave up')
        ? 'The agent gave up and apologized instead of finishing the task.'
        : 'The agent stopped in the middle of the task without giving an answer.'
    case 'truncated-output':
      return "The model's answer was cut off because it hit its length limit."
    case 'handoff-pingpong':
      return `Two agents, ${tick(String(v.a))} and ${tick(String(v.b))}, kept handing the task back and forth (${v.n} handoffs) without making progress.`
    case 'slow-step':
      return `One step (${tool}) took ${v.dur}, ${v.pct}% of the whole run.`
    case 'expensive-step':
      return `A single model call cost ${v.usd}, ${v.pct}% of the total bill.`
    case 'unused-tools':
      return `The agent was given ${v.n} tool${Number(v.n) === 1 ? '' : 's'} it never used, which adds cost to every step.`
  }
  return tick(f.title)
}

/** 1–3 concrete fixes for a finding, in plain English. */
export function fixesFor(f: Finding): string[] {
  const v = (f.vars ?? {}) as Record<string, string | number>
  const tool = tick(String(v.tool ?? 'the tool'))
  switch (f.rule) {
    case 'loop':
      return [
        `Remember what the agent already tried: if ${tool} is called again with the same input, return the earlier result and tell the agent it already has it.`,
        'Set a maximum number of steps, and ask for a best-effort answer when it is reached.',
        'Tell the agent in its instructions to stop searching once new results stop adding information.',
      ]
    case 'tool-error':
      return [
        `Make ${tool} more reliable: add a timeout and retry with a short wait between attempts.`,
        'When a tool fails, show the error to the agent and give it a fallback (another tool, or asking the user).',
        'Stop after two identical failures instead of retrying the same call.',
      ]
    case 'unknown-tool':
      return [
        `Reject calls to tools that don't exist and tell the agent which tools it actually has${v.near && v.near !== 'nothing' ? ` (for example “${tick(String(v.near))}”)` : ''}.`,
        'Turn on strict function calling so the model can only pick real tool names.',
        'Give every tool a clear name and a one-line description of when to use it.',
      ]
    case 'invalid-args':
      return [
        `Check the agent's input to ${tool} before running it, and send any error back so the agent can correct it.`,
        'Turn on strict function calling (structured outputs) so the input must match the tool definition.',
        'List the allowed values in the tool description.',
      ]
    case 'prompt-injection':
      return [
        'Treat everything that comes back from tools and web pages as untrusted text, never as instructions.',
        'Require a human to confirm risky actions such as sending email, paying, or deleting files.',
        'Only allow the agent to contact addresses and websites on an approved list.',
      ]
    case 'context-bloat':
      return [
        `Make ${tool} return only what is needed: a summary, the top results, or the relevant fields.`,
        'Drop large tool results from the conversation once the agent has used them.',
      ]
    case 'context-overflow':
      return [
        'Summarize older steps instead of keeping the full history.',
        'Shorten tool results before adding them to the conversation.',
      ]
    case 'no-final-answer':
      return [
        'Always end with the model writing an answer, even if a step limit is reached.',
        'When tools fail, let the agent explain what it found so far instead of stopping silently.',
      ]
    case 'truncated-output':
      return [
        'Raise the output length limit for this step.',
        'Ask for shorter answers or split the task into smaller steps.',
      ]
    case 'handoff-pingpong':
      return [
        'Give each agent a clear, non-overlapping job description.',
        'Pass the reason for the handoff along with the task.',
        'Limit the number of handoffs per run.',
      ]
    case 'slow-step':
      return [
        `Add a timeout to ${tool} and cache its results.`,
        'Run independent steps at the same time instead of one after another.',
      ]
    case 'expensive-step':
      return [
        'Use a cheaper model for this step, or send less text to it.',
        'Turn on prompt caching for the parts that never change.',
      ]
    case 'unused-tools':
      return ['Only give the agent the tools it needs for this task.']
  }
  return [tick(f.fix)]
}

/** Up to 3 fixes: the cause of death first, then the next most serious distinct problem. */
export function topFixes(a: Analysis): string[] {
  const k = a.verdict.status === 'alive' ? undefined : a.verdict.killer
  const out: string[] = []
  if (k) out.push(...fixesFor(k).slice(0, 2))
  for (const f of a.findings) {
    if (out.length >= 3) break
    if (f === k || f.rule === k?.rule || f.severity === 'info' || f.severity === 'low') continue
    out.push(fixesFor(f)[0])
  }
  if (k && out.length < 3) out.push(...fixesFor(k).slice(2, 2 + 3 - out.length))
  return out.slice(0, 3)
}

function firstArg(s: Span): string | undefined {
  const args = s.toolArgs
  if (args && typeof args === 'object') {
    for (const v of Object.values(args as Record<string, unknown>))
      if (typeof v === 'string' && v.trim()) return v
    for (const v of Object.values(args as Record<string, unknown>))
      if (typeof v === 'number') return String(v)
  }
  return undefined
}

function stepText(
  s: Span,
  isLastLlm: boolean,
  finalOutput?: string,
): { text: string; detail?: string } | null {
  if (s.kind === 'llm') {
    const out = s.output ?? []
    const calls = out.flatMap((m) => m.toolCalls ?? []).map((c) => c.name)
    if (s.status === 'error')
      return { text: 'The model call failed', detail: errorSummary(s.error) }
    if (calls.length) {
      const uniq = [...new Set(calls)]
      return {
        text: uniq.every((c) => /^transfer_to_/i.test(c))
          ? `Decided to ${human(uniq[0])}`
          : `Decided to use ${uniq.map(human).join(', ')}`,
      }
    }
    const text =
      out
        .map((m) => m.content)
        .join(' ')
        .trim() || (isLastLlm ? (finalOutput ?? '') : '')
    if (!text) return { text: 'The model replied with nothing' }
    return { text: isLastLlm ? 'Wrote the final answer' : 'Replied', detail: quote(text, 110) }
  }
  if (s.kind === 'tool') {
    const name = s.toolName ?? s.name
    const arg = firstArg(s)
    const text = `Used ${name}${arg ? ` with ${quote(arg, 60)}` : ''}`
    if (s.status === 'error')
      return { text: `${text}: it failed`, detail: errorSummary(s.error || s.toolResult) }
    return { text, detail: s.toolResult ? `Got back ${quote(s.toolResult, 90)}` : undefined }
  }
  if (s.kind === 'handoff') {
    const from = s.attributes?.from_agent
    const to = s.attributes?.to_agent
    return {
      text:
        from && to
          ? `${String(from)} handed the task to ${String(to)}`
          : `Handed the task to another agent (${s.name})`,
    }
  }
  if (s.kind === 'retrieval')
    return {
      text: 'Looked up documents',
      detail: s.toolResult ? quote(s.toolResult, 90) : undefined,
    }
  if (s.kind === 'guardrail') return { text: `Ran a safety check (${s.name})` }
  return null
}

export function plainSteps(a: Analysis): PlainStep[] {
  const killer = a.verdict.status === 'alive' ? undefined : a.verdict.killer
  const failedIds = new Set(
    killer ? (killer.rule === 'context-bloat' ? killer.spanIds.slice(0, 1) : killer.spanIds) : [],
  )
  const llm = a.trace.spans.filter((s) => s.kind === 'llm')
  const lastLlm = llm[llm.length - 1]
  const steps: PlainStep[] = []
  for (const s of a.trace.spans) {
    const st = stepText(s, s === lastLlm, a.trace.finalOutput)
    if (!st) continue
    steps.push({
      id: s.id,
      n: steps.length + 1,
      text: st.text,
      detail: st.detail,
      failed: failedIds.has(s.id),
    })
  }
  return steps
}

const STATUS = {
  alive: ['healthy', 'Healthy'],
  injured: ['problems', 'Finished, with problems'],
  dead: ['failed', 'Failed'],
} as const

export function plainReport(a: Analysis): PlainReport {
  const steps = plainSteps(a)
  const [status, statusLabel] = STATUS[a.verdict.status]
  const facts = [
    `${steps.length} step${steps.length === 1 ? '' : 's'}`,
    a.duration > 0 ? `${fmtMs(a.duration)}${a.trace.timingEstimated ? ' (estimated)' : ''}` : '',
    a.totalCost > 0 ? `${fmtUsd(a.totalCost)} spent` : '',
    a.wastedUsd > 0.0001 && a.verdict.status !== 'alive' ? `${fmtUsd(a.wastedUsd)} wasted` : '',
  ]
    .filter(Boolean)
    .join(' · ')
  return {
    name: a.trace.name || 'Agent run',
    grade: a.grade,
    status,
    statusLabel,
    cause: causeSentence(a),
    steps,
    failedStep: steps.find((s) => s.failed)?.n,
    fixes: topFixes(a),
    facts,
    format: FORMAT_LABELS[a.trace.format] ?? a.trace.format,
  }
}

/** Plain-text version for "Copy report". Always redacted. */
export function reportText(r: PlainReport, url: string): string {
  const lines = [
    `Agent Autopsy report: ${r.name}`,
    `Grade: ${r.grade} (${r.statusLabel})`,
    `${r.status === 'healthy' ? 'Result' : 'Cause of death'}: ${r.cause}`,
    r.facts,
    '',
    'What happened:',
    ...r.steps.map(
      (s) =>
        `${s.failed ? '✕' : ' '} ${String(s.n).padStart(2)}. ${s.text}${s.detail ? ` — ${s.detail}` : ''}`,
    ),
    '',
    r.fixes.length ? 'How to fix:' : '',
    ...r.fixes.map((f) => `- ${f}`),
    '',
    `Examined with ${url}`,
  ]
  return redactText(lines.filter((l, i, arr) => !(l === '' && arr[i - 1] === '')).join('\n')).text
}
