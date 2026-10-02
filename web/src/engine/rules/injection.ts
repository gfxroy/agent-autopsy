import type { Finding, Span } from '../types'
import type { Rule } from './types'

interface Pattern {
  re: RegExp
  label: string
  strong: boolean
}

export const INJECTION_PATTERNS: Pattern[] = [
  {
    re: /\b(ignore|disregard|forget|override)\b[^.\n]{0,30}\b(previous|prior|above|earlier|all|your|system)\b[^.\n]{0,20}\b(instructions?|directions?|prompts?|rules|guidelines)\b/i,
    label: 'override instructions',
    strong: true,
  },
  {
    re: /\b(new|updated|real) (system )?instructions?\s*[:-]/i,
    label: 'fake new instructions',
    strong: true,
  },
  {
    re: /<\|?(im_start|im_end|system|endoftext)\|?>|\[\/?INST\]|<\/?(system|assistant)>/i,
    label: 'chat-template tokens',
    strong: true,
  },
  {
    re: /\b(reveal|print|repeat|output)\b[^.\n]{0,30}\b(system prompt|hidden instructions|api[_ ]?keys?|secrets?|credentials|password)/i,
    label: 'secret exfiltration request',
    strong: true,
  },
  {
    re: /\b(send|forward|email|post|upload|exfiltrate|leak|transmit)\b[^.\n]{0,80}\b(to|at)\b[^.\n]{0,40}(https?:\/\/\S+|[\w.+-]+@[\w-]+\.[\w.]+)/i,
    label: 'send data to external address',
    strong: true,
  },
  {
    re: /\b(AI|assistant|agent|LLM|language model|chatbot)s?\b[^.\n]{0,40}\b(must|should|are instructed to|need to|will now)\b/i,
    label: 'addresses the AI directly',
    strong: false,
  },
  {
    re: /\byou are now\b|\bact as\b[^.\n]{0,20}\b(admin|developer|DAN|unrestricted)/i,
    label: 'role hijack',
    strong: false,
  },
  {
    re: /\bdo not (tell|inform|mention|reveal|alert)\b[^.\n]{0,30}\b(user|human|anyone)\b/i,
    label: 'conceal from user',
    strong: true,
  },
  {
    re: /<!--[\s\S]{0,600}?(instruction|assistant|ignore|AI agent|model)[\s\S]{0,600}?-->/i,
    label: 'hidden HTML comment',
    strong: false,
  },
  {
    re: /[\u200B-\u200D\u2060\uFEFF]{3,}|[\u{E0000}-\u{E007F}]/u,
    label: 'invisible unicode',
    strong: false,
  },
  {
    re: /\b(IMPORTANT|URGENT|ATTENTION)\b\s*[:!][^.\n]{0,60}\b(AI|assistant|agent|model)\b/i,
    label: 'urgent note to the AI',
    strong: false,
  },
]

export function scanInjection(text: string | undefined): {
  labels: string[]
  score: number
  excerpt?: string
} {
  if (!text) return { labels: [], score: 0 }
  const labels: string[] = []
  let score = 0
  let excerpt: string | undefined
  for (const p of INJECTION_PATTERNS) {
    const m = p.re.exec(text)
    if (!m) continue
    labels.push(p.label)
    score += p.strong ? 2 : 1
    if (!excerpt || p.strong) {
      const at = Math.max(0, m.index - 40)
      excerpt = text
        .slice(at, m.index + Math.min(m[0].length, 160) + 20)
        .replace(/\s+/g, ' ')
        .trim()
    }
  }
  return { labels, score, excerpt }
}

function indicators(text: string): string[] {
  const out = new Set<string>()
  for (const m of text.matchAll(/https?:\/\/[^\s"'<>)]+|[\w.+-]+@[\w-]+\.[\w.]+/g))
    out.add(m[0].toLowerCase().replace(/[.,;]+$/, ''))
  return [...out]
}

/** Prompt-injection-looking content in tool outputs, and whether the agent then complied. */
export const injectionRule: Rule = {
  id: 'prompt-injection',
  name: 'Prompt injection in tool output',
  description:
    'Tool or retrieval results that contain instructions aimed at the model — and later actions that look like compliance.',
  run(ctx) {
    const findings: Finding[] = []
    const sources = [...ctx.tools, ...ctx.spans.filter((s) => s.kind === 'retrieval')]
    for (const t of sources) {
      const scan = scanInjection(t.toolResult)
      if (scan.score < 2) continue
      const iocs = indicators(t.toolResult ?? '')
      const toolNamesMentioned = [...ctx.declared.keys()].filter(
        (n) => n !== t.toolName && new RegExp(`\\b${n}\\b`).test(t.toolResult ?? ''),
      )
      const later = ctx.tools.filter((x) => x.start >= t.end - 1 && x.id !== t.id)
      const complied: Span[] = later.filter((x) => {
        const args = (x.toolArgsRaw ?? JSON.stringify(x.toolArgs ?? '')).toLowerCase()
        return iocs.some((i) => args.includes(i)) || toolNamesMentioned.includes(x.toolName ?? '')
      })
      const name = t.toolName ?? t.name
      findings.push({
        rule: 'prompt-injection',
        severity: complied.length ? 'critical' : 'high',
        title: complied.length
          ? `Agent obeyed an injection from \`${name}\` output`
          : `Prompt-injection text in \`${name}\` output`,
        detail: `Signals: ${scan.labels.join(', ')}. Excerpt: "${scan.excerpt}".${complied.length ? ` Afterwards the agent called ${complied.map((c) => `\`${c.toolName}\``).join(', ')} with values taken from the injected text.` : ''}`,
        fix: 'Treat tool output as untrusted data: wrap it in clear delimiters, tell the model never to follow instructions inside it, require human confirmation for side-effecting tools (email, payments, file writes), and allow-list outbound destinations.',
        spanIds: [t.id, ...complied.map((c) => c.id)],
        cause: complied.length
          ? `Poisoned by prompt injection via \`${name}\``
          : `Exposed to prompt injection via \`${name}\``,
        vars: { tool: name, action: complied[0]?.toolName ?? 'nothing (yet)' },
      })
    }
    return findings
  },
}
