/** Deterministic roast lines — same trace, same roast. */
import type { Analysis, Grade } from './analyze'
import type { Finding, RuleId } from './types'
import { hash32 } from './util'

const LINES: Record<RuleId, string[]> = {
  loop: [
    'Called `{tool}` {n} times with the same arguments. Einstein had a word for this.',
    '`{tool}` ×{n}. Your agent has the short-term memory of a goldfish with a token budget.',
    'It asked `{tool}` the same thing {n} times, hoping the internet would change its mind.',
  ],
  'tool-error': [
    '`{tool}` failed {n}× and your agent just kept hitting it like a stuck vending machine.',
    'Error messages are free advice. Your agent read `{tool}`’s {n} of them and chose violence.',
    '`{tool}` said no. {n} times. Consent is important, even for tools.',
  ],
  'unknown-tool': [
    'Called `{tool}` — a tool that exists only in its dreams. Closest real one: `{near}`.',
    '`{tool}` isn’t a tool, it’s a vibe. Your agent manifested it.',
    'Hallucinated `{tool}` with full confidence. Promote it to middle management.',
  ],
  'invalid-args': [
    'Sent `{tool}` arguments that violate its own schema ({issue}). Reading is fundamental.',
    'The schema was right there. `{tool}` got {issue} anyway.',
    'Your agent treats JSON Schema like the terms & conditions: scrolled past, clicked accept.',
  ],
  'context-bloat': [
    'Shoved a {tokens}-token `{tool}` dump into context and re-read it {n} times. Hoarder energy.',
    'Paid to re-read the same {tokens}-token `{tool}` blob {n} times. Netflix has cheaper re-watches.',
    'Context window? More like context landfill.',
  ],
  'context-overflow': [
    'Context window {pct}% full. It’s not thinking, it’s drowning.',
    'At {pct}% context, your agent is basically a browser with 400 tabs open.',
  ],
  'prompt-injection': [
    'A random web page said "ignore previous instructions" and your agent said "yes chef". Then it called `{action}`.',
    'Got socially engineered by `{tool}` output. Your agent would buy gift cards for a Nigerian prince.',
    'Read untrusted text, obeyed untrusted text. Security team has entered the chat.',
  ],
  'no-final-answer': [
    'Did all that work and then… left. No answer. Irish goodbye from an LLM.',
    'The user asked a question. The agent answered with silence and an invoice.',
  ],
  'truncated-output': [
    'Ran out of max_tokens mid-sentence. Like a movie that ends right bef',
    'Cut off by max_tokens {n}×. Concise is a skill; so is budgeting.',
  ],
  'slow-step': [
    '`{tool}` took {dur}. Your users aged visibly.',
    '{pct}% of the run spent waiting on `{tool}`. Grab a coffee. Grab several.',
  ],
  'expensive-step': [
    'One call ate {pct}% of the budget ({usd}). Champagne prompt, lemonade output.',
    'Spent {usd} on a single call. Somewhere a finance team felt a disturbance.',
  ],
  'unused-tools': [
    'Declared {n} tools it never touched. Gym membership energy.',
    'Paid to describe `{tool}` on every call and never used it. Like carrying an umbrella in the desert.',
  ],
  'handoff-pingpong': [
    '{a} ⇄ {b} handed off {n} times. Customer service simulator achieved.',
    '“Not my department” — both agents, {n} times.',
  ],
}

const ALIVE = [
  'Clean run. Nothing to roast. Honestly a little disappointing.',
  'Efficient, correct, no loops. Are you sure this is an AI agent?',
  'Healthy as a horse. A very well-prompted horse.',
]

const GRADE_QUIP: Record<Grade, string> = {
  'A+': 'Frame it.',
  A: 'Ship it.',
  'A-': 'Nearly flawless.',
  'B+': 'Solid, with a limp.',
  B: 'Functional. Barely charming.',
  'B-': 'Passes, with paperwork.',
  'C+': 'Concerning.',
  C: 'Your agent needs supervision.',
  'C-': 'Unsupervised child energy.',
  D: 'Expensive and confused.',
  F: 'Time of death: called.',
}

function fill(template: string, vars: Record<string, string | number> = {}): string {
  return template.replace(/\{(\w+)\}/g, (_, k) => String(vars[k] ?? '…'))
}

export function roastFinding(f: Finding, seed = ''): string {
  const lines = LINES[f.rule] ?? ['No comment.']
  return fill(lines[hash32(seed + f.rule + f.spanIds.join()) % lines.length], f.vars)
}

export function roastHeadline(a: Analysis): string {
  if (a.verdict.status === 'alive') return ALIVE[hash32(a.trace.id) % ALIVE.length]
  return a.verdict.killer ? roastFinding(a.verdict.killer, a.trace.id) : GRADE_QUIP[a.grade]
}

export function gradeQuip(g: Grade): string {
  return GRADE_QUIP[g]
}
