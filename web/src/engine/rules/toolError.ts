import type { Finding, Span } from '../types'
import { wasteFromLlm, type Rule } from './types'

function fixFor(err: string): string {
  if (/time(d)? ?out|ETIMEDOUT|deadline/i.test(err))
    return 'Add a timeout with exponential backoff, and give the model a cheaper fallback tool when the call keeps timing out.'
  if (/rate.?limit|429/i.test(err))
    return 'Respect rate limits: add jittered backoff in the tool wrapper rather than letting the model retry blindly.'
  if (/not found|404|ENOENT|no such file/i.test(err))
    return 'The target does not exist — return a helpful message listing valid options (e.g. directory listing) so the model can self-correct.'
  if (/permission|403|401|unauthori[sz]ed|forbidden/i.test(err))
    return 'Credentials/permissions problem — fix the tool configuration; the model cannot recover from this by retrying.'
  if (/assert|failed|test/i.test(err))
    return 'Return the failing assertion and relevant code context in the tool result, and require the model to change code before re-running.'
  return 'Return structured, actionable error messages from the tool and tell the model to change its approach after a failure instead of retrying the same call.'
}

/** Tool failures and blind retries. */
export const toolErrorRule: Rule = {
  id: 'tool-error',
  name: 'Tool errors & retries',
  description: 'Tools that failed, and failures that were retried without changing anything.',
  run(ctx) {
    const byTool = new Map<string, Span[]>()
    for (const t of ctx.tools)
      byTool.set(t.toolName ?? t.name, [...(byTool.get(t.toolName ?? t.name) ?? []), t])
    const findings: Finding[] = []
    for (const [name, calls] of byTool) {
      const errors = calls.filter((c) => c.status === 'error')
      if (!errors.length) continue
      // Calls to undeclared tools are reported by the unknown-tool rule.
      if (ctx.declared.size && !ctx.declared.has(name)) continue
      const last = calls[calls.length - 1]
      const recovered = last.status === 'ok'
      const identicalRetries = errors.filter(
        (e, i) => i > 0 && e.toolArgsRaw === errors[i - 1].toolArgsRaw,
      ).length
      const severity =
        !recovered && errors.length >= 2
          ? 'critical'
          : !recovered || errors.length >= 3
            ? 'high'
            : 'medium'
      const errText = (errors[0].error ?? errors[0].toolResult ?? 'error')
        .replace(/\s+/g, ' ')
        .slice(0, 160)
      const w = wasteFromLlm(
        ctx,
        errors.map((e) => ctx.requestedBy.get(e.id)).filter((x): x is string => !!x),
      )
      findings.push({
        rule: 'tool-error',
        severity,
        title: `\`${name}\` failed ${errors.length}×${recovered ? ' (recovered)' : ' (never recovered)'}`,
        detail: `First error: "${errText}".${identicalRetries ? ` ${identicalRetries} retr${identicalRetries === 1 ? 'y was' : 'ies were'} sent with identical arguments.` : ''}`,
        fix: fixFor(errText),
        spanIds: errors.map((e) => e.id),
        wastedTokens: w.tokens,
        wastedUsd: w.usd,
        wasteBySpan: w.bySpan,
        cause: recovered ? `Wounded by \`${name}\` failure` : `Fatal \`${name}\` failure`,
        vars: { tool: name, n: errors.length },
      })
    }
    return findings
  },
}
