import type { Rule } from './types'

const GIVE_UP =
  /\b(I('m| am) sorry,? (but )?I (can(no|')t|could(n't| not)|was unable|am unable)|I('m| am) unable to|I (could not|couldn't|was unable to|cannot|can't) (find|complete|access|retrieve|help|do|determine|get|finish)|unfortunately,? I (could(n't| not)|was unable|can(no|')t))/i

/** The run ended without a final answer (mid-tool-call, error, empty reply, or gave up). */
export const noFinalAnswerRule: Rule = {
  id: 'no-final-answer',
  name: 'Ended without answering',
  description: 'The agent stopped mid-tool-call, crashed, replied with nothing, or gave up.',
  run(ctx) {
    if (!ctx.llm.length) {
      return []
    }
    const lastLlm = [...ctx.llm].sort((a, b) => a.end - b.end)[ctx.llm.length - 1]
    const root = ctx.spans[0]
    const final = ctx.trace.finalOutput?.trim()
    const pendingCalls = lastLlm.output?.some((m) => m.toolCalls?.length)
    if (root.status === 'error' || !final || pendingCalls) {
      const why =
        root.status === 'error'
          ? `the run crashed (${root.error ?? 'error'})`
          : pendingCalls
            ? 'the last model turn requested tool calls that were never answered by another model turn'
            : 'the final model turn produced no text'
      return [
        {
          rule: 'no-final-answer',
          severity: 'high',
          title: 'Agent ended without answering the user',
          detail: `The run stopped because ${why}. The user received nothing useful.`,
          fix: 'Always finish with a model turn after the last tool result; on max-iteration / budget limits, ask the model for a best-effort answer with what it has instead of exiting silently.',
          spanIds: [lastLlm.id],
          cause: 'Died mid-task without answering',
          vars: {},
        },
      ]
    }
    if (GIVE_UP.test(final.slice(0, 300))) {
      return [
        {
          rule: 'no-final-answer',
          severity: 'medium',
          title: 'Agent gave up',
          detail: `Final answer starts with an apology/refusal: "${final.slice(0, 140)}".`,
          fix: 'Check the preceding tool errors; give the agent fallbacks (alternate tools, ask a clarifying question) instead of conceding.',
          spanIds: [lastLlm.id],
          cause: 'Gave up and apologized',
          vars: {},
        },
      ]
    }
    return []
  },
}

/** Model output cut off by the token limit. */
export const truncatedRule: Rule = {
  id: 'truncated-output',
  name: 'Truncated output',
  description: 'A model response hit max_tokens / length and was cut off.',
  run(ctx) {
    const hits = ctx.llm.filter((l) =>
      /^(length|max_tokens|max_output_tokens|incomplete)$/i.test(l.finishReason ?? ''),
    )
    if (!hits.length) return []
    const lastId = ctx.llm[ctx.llm.length - 1]?.id
    return [
      {
        rule: 'truncated-output',
        severity: hits.some((h) => h.id === lastId) ? 'high' : 'medium',
        title: `${hits.length} response${hits.length > 1 ? 's' : ''} cut off by max_tokens`,
        detail: `Finish reason "${hits[0].finishReason}" — the model ran out of output budget mid-response${hits[0].output?.some((m) => m.toolCalls?.length) ? ' (tool-call JSON may be incomplete)' : ''}.`,
        fix: 'Raise max_tokens / max_output_tokens for this step, ask for more concise output, or split the task into smaller steps.',
        spanIds: hits.map((h) => h.id),
        cause: 'Cut off mid-sentence (max_tokens)',
        vars: { n: hits.length },
      },
    ]
  },
}
