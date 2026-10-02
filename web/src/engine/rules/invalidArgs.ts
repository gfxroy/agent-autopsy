import { validateArgs } from '../schema'
import type { Finding } from '../types'
import { wasteFromLlm, type Rule } from './types'

/** Tool arguments that are not valid JSON or violate the declared JSON schema. */
export const invalidArgsRule: Rule = {
  id: 'invalid-args',
  name: 'Invalid tool arguments',
  description:
    'Arguments that are malformed JSON or break the tool’s declared schema (missing required fields, wrong types, invented enum values).',
  run(ctx) {
    const findings: Finding[] = []
    const seen = new Set<string>()
    const check = (
      name: string,
      args: unknown,
      raw: string | undefined,
      spanId: string,
      llmId?: string,
    ) => {
      const def = ctx.declared.get(name)
      if (!def) return
      const key = `${spanId}`
      if (seen.has(key)) return
      seen.add(key)
      let issues: string[] = []
      let severity: Finding['severity'] = 'high'
      if (args === undefined && raw && raw.trim()) {
        issues = ['arguments are not valid JSON']
      } else if (def.parameters) {
        const res = validateArgs(args ?? {}, def.parameters)
        issues = res.map((r) => `${r.path}: ${r.message}`)
        if (res.length && res.every((r) => r.kind === 'unknown-prop')) severity = 'medium'
      }
      if (!issues.length) return
      const w = wasteFromLlm(ctx, llmId ? [llmId] : [])
      const enumIssue = issues.find((i) => i.includes('is not one of'))
      findings.push({
        rule: 'invalid-args',
        severity,
        title: `\`${name}\` called with invalid arguments`,
        detail: `${issues.slice(0, 4).join('; ')}${issues.length > 4 ? ` (+${issues.length - 4} more)` : ''}. Raw: ${(raw ?? '').slice(0, 120)}`,
        fix: enumIssue
          ? 'The model invented a value outside the allowed enum. Enable strict mode / structured outputs so the schema is enforced at decode time, and list allowed values in the tool description.'
          : 'Enable strict function calling (schema-constrained decoding), validate args before executing, and return the validation error to the model so it can repair the call.',
        spanIds: [spanId],
        wastedTokens: w.tokens,
        wastedUsd: w.usd,
        wasteBySpan: w.bySpan,
        cause: enumIssue
          ? `Schema hallucination in \`${name}\``
          : `Malformed \`${name}\` arguments`,
        vars: { tool: name, issue: issues[0] },
      })
    }
    for (const t of ctx.tools)
      check(t.toolName ?? t.name, t.toolArgs, t.toolArgsRaw, t.id, ctx.requestedBy.get(t.id))
    for (const { llm, call, toolSpan } of ctx.requestedCalls)
      if (!toolSpan) check(call.name, call.args, call.argsRaw, llm.id, llm.id)
    return findings
  },
}
