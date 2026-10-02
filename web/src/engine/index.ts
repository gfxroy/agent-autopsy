import { importTrace } from './importers'
import { normalizeTrace } from './normalize'
import type { FormatId, Trace } from './types'

export function loadTrace(text: string, name?: string, format?: FormatId): Trace {
  return normalizeTrace(importTrace(text, name, format), text)
}

export * from './types'
export { analyze, type Analysis } from './analyze'
