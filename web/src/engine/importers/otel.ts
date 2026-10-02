/**
 * OpenTelemetry OTLP/JSON (`resourceSpans → scopeSpans → spans`) using GenAI semantic
 * conventions (gen_ai.operation.name, gen_ai.input.messages, gen_ai.tool.call.*, ...).
 * Also accepts an array / JSONL of OTLP export payloads.
 */
import type { Span, ToolDef, Trace } from '../types'
import { asString, isRecord, nanosToMs } from '../util'
import { flatToSpan } from './genai'
import type { Importer } from './types'

export function otlpValue(v: unknown): unknown {
  if (!isRecord(v)) return v
  if ('stringValue' in v) return v.stringValue
  if ('intValue' in v) return Number(v.intValue)
  if ('doubleValue' in v) return Number(v.doubleValue)
  if ('boolValue' in v) return Boolean(v.boolValue)
  if (isRecord(v.arrayValue)) return ((v.arrayValue.values as unknown[]) ?? []).map(otlpValue)
  if (isRecord(v.kvlistValue)) return otlpAttrs(v.kvlistValue.values)
  if ('bytesValue' in v) return v.bytesValue
  return undefined
}

export function otlpAttrs(list: unknown): Record<string, unknown> {
  const out: Record<string, unknown> = {}
  if (!Array.isArray(list)) return out
  for (const kv of list)
    if (isRecord(kv) && typeof kv.key === 'string') out[kv.key] = otlpValue(kv.value)
  return out
}

function payloads(d: unknown): Record<string, unknown>[] {
  if (isRecord(d) && Array.isArray(d.resourceSpans)) return [d]
  if (Array.isArray(d))
    return d.filter((x) => isRecord(x) && Array.isArray(x.resourceSpans)) as Record<
      string,
      unknown
    >[]
  return []
}

export const otelImporter: Importer = {
  id: 'otel',
  label: 'OpenTelemetry GenAI (OTLP JSON)',
  detect(d) {
    return payloads(d).length ? 0.99 : 0
  },
  parse(d, name): Trace {
    const spans: Span[] = []
    const tools = new Map<string, ToolDef>()
    let service: string | undefined
    for (const p of payloads(d)) {
      for (const rs of (p.resourceSpans as unknown[]).filter(isRecord)) {
        const res = isRecord(rs.resource) ? otlpAttrs(rs.resource.attributes) : {}
        service = service ?? asString(res['service.name'])
        const scopes = (rs.scopeSpans ?? rs.instrumentationLibrarySpans) as unknown[]
        for (const ss of (scopes ?? []).filter(isRecord)) {
          for (const s of ((ss.spans as unknown[]) ?? []).filter(isRecord)) {
            const attrs = otlpAttrs(s.attributes)
            const status = isRecord(s.status) ? s.status : {}
            const isError = status.code === 2 || status.code === 'STATUS_CODE_ERROR'
            let statusError = asString(status.message) || undefined
            if (isError && !statusError && Array.isArray(s.events)) {
              const ex = s.events.find((e) => isRecord(e) && e.name === 'exception') as
                Record<string, unknown> | undefined
              if (ex) statusError = asString(otlpAttrs(ex.attributes)['exception.message'])
            }
            const { span, tools: defs } = flatToSpan({
              id: String(s.spanId ?? `span_${spans.length}`),
              parentId: asString(s.parentSpanId),
              name: String(s.name ?? 'span'),
              start: nanosToMs(s.startTimeUnixNano) ?? 0,
              end: nanosToMs(s.endTimeUnixNano) ?? nanosToMs(s.startTimeUnixNano) ?? 0,
              attrs,
              isError,
              statusError: isError ? (statusError ?? 'error') : undefined,
            })
            for (const t of defs) tools.set(t.name, t)
            spans.push(span)
          }
        }
      }
    }
    return {
      id: '',
      name: name ?? service ?? 'OTel GenAI trace',
      format: 'otel',
      spans,
      tools: [...tools.values()],
      timingEstimated: false,
      meta: { service },
    }
  },
}
