import type { FormatId, Trace } from '../types'

export interface Importer {
  id: FormatId
  label: string
  /** 0..1 confidence that `data` is in this format. */
  detect(data: unknown): number
  parse(data: unknown, name?: string): Trace
}
