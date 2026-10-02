/**
 * MCP (Model Context Protocol) JSON-RPC 2.0 logs. Accepts raw message lines, wrapped records
 * (`{timestamp, direction, message}`) and Claude-Desktop-style log lines
 * (`2025-06-01T10:00:00.000Z [server] [info] Message from client: {...}`). Requests and responses
 * are paired by id; `tools/list` declares tool schemas, `tools/call` becomes a tool span.
 */
import type { Span, ToolDef, Trace } from '../types'
import { asString, contentToText, isRecord, toMs } from '../util'
import { looksLikeError, syntheticToolMs } from './messages'
import type { Importer } from './types'

interface Rec {
  msg: Record<string, unknown>
  ts?: number
  dir?: 'client' | 'server'
  server?: string
}

function unwrap(x: unknown): Rec | undefined {
  if (!isRecord(x)) return undefined
  if (x.jsonrpc === '2.0') return { msg: x }
  if (isRecord(x.__message) && x.__message.jsonrpc === '2.0') {
    const prefix = String(x.__logPrefix ?? '')
    const ts = toMs(prefix.match(/^\S+/)?.[0])
    const dir = /from client/i.test(prefix)
      ? 'client'
      : /from server/i.test(prefix)
        ? 'server'
        : undefined
    const server = prefix.match(/\[([^\]]+)\]/)?.[1]
    return { msg: x.__message, ts, dir, server }
  }
  const inner = x.message ?? x.payload ?? x.data
  if (isRecord(inner) && inner.jsonrpc === '2.0') {
    const d = String(x.direction ?? x.dir ?? '')
    return {
      msg: inner,
      ts: toMs(x.timestamp ?? x.ts ?? x.time),
      dir: /^(send|out|client|request)/i.test(d)
        ? 'client'
        : /^(recv|in|server|response)/i.test(d)
          ? 'server'
          : undefined,
      server: asString(x.server),
    }
  }
  return undefined
}

function records(d: unknown): Rec[] {
  if (!Array.isArray(d)) return []
  return d.map(unwrap).filter((r): r is Rec => !!r)
}

export const mcpImporter: Importer = {
  id: 'mcp',
  label: 'MCP JSON-RPC log',
  detect(d) {
    if (!Array.isArray(d) || !d.length) return 0
    const recs = records(d)
    if (recs.length < Math.max(1, d.length * 0.6)) return 0
    return recs.some(
      (r) =>
        typeof r.msg.method === 'string' &&
        (r.msg.method.startsWith('tools/') || r.msg.method === 'initialize'),
    )
      ? 0.97
      : 0.5
  },
  parse(d, name): Trace {
    const recs = records(d)
    const pending = new Map<string, { rec: Rec; idx: number }>()
    const spans: Span[] = []
    const tools: ToolDef[] = []
    let t = 0
    let estimated = false
    let serverName: string | undefined
    const rootId = 'mcp-root'
    recs.forEach((rec, idx) => {
      const m = rec.msg
      if (typeof m.method === 'string' && m.id !== undefined) {
        pending.set(String(m.id), { rec, idx })
        return
      }
      if (m.id === undefined || typeof m.method === 'string') return // notifications
      const req = pending.get(String(m.id))
      if (!req) return
      pending.delete(String(m.id))
      const method = String(req.rec.msg.method)
      const params = isRecord(req.rec.msg.params) ? req.rec.msg.params : {}
      const result = isRecord(m.result) ? m.result : undefined
      const error = isRecord(m.error) ? m.error : undefined
      if (method === 'initialize' && result && isRecord(result.serverInfo))
        serverName = asString(result.serverInfo.name)
      if (method === 'tools/list' && result && Array.isArray(result.tools)) {
        for (const tool of result.tools.filter(isRecord))
          tools.push({
            name: String(tool.name),
            description: asString(tool.description),
            parameters: isRecord(tool.inputSchema)
              ? (tool.inputSchema as ToolDef['parameters'])
              : undefined,
          })
      }
      let start = req.rec.ts
      let end = rec.ts
      if (start === undefined || end === undefined) {
        estimated = true
        start = t
        end = t + syntheticToolMs(`${method}${m.id}`, JSON.stringify(result ?? '').slice(0, 4000))
      }
      t = end + 40
      if (method === 'tools/call') {
        const toolName = asString(params.name) ?? 'unknown'
        const text = result
          ? contentToText(result.content ?? result.structuredContent ?? result)
          : ''
        const isError = !!error || result?.isError === true
        spans.push({
          id: `mcp-${String(m.id)}`,
          parentId: rootId,
          kind: 'tool',
          name: toolName,
          start,
          end,
          status: isError || looksLikeError(text) ? 'error' : 'ok',
          error: error
            ? `${String(error.code ?? '')} ${String(error.message ?? '')}`.trim()
            : isError
              ? text.slice(0, 300)
              : undefined,
          toolName,
          toolCallId: String(m.id),
          toolArgs: params.arguments ?? {},
          toolArgsRaw: JSON.stringify(params.arguments ?? {}),
          toolResult: error ? JSON.stringify(error) : text,
          attributes: { 'mcp.method': method, 'mcp.server': rec.server ?? req.rec.server },
        })
      } else {
        spans.push({
          id: `mcp-${String(m.id)}`,
          parentId: rootId,
          kind: 'other',
          name: method,
          start,
          end,
          status: error ? 'error' : 'ok',
          error: error ? String(error.message ?? 'error') : undefined,
          attributes: { 'mcp.method': method, params, result },
        })
      }
    })
    // Requests that never got a response.
    for (const { rec, idx } of pending.values()) {
      const method = String(rec.msg.method)
      const params = isRecord(rec.msg.params) ? rec.msg.params : {}
      const start = rec.ts ?? t + idx
      spans.push({
        id: `mcp-${String(rec.msg.id)}`,
        parentId: rootId,
        kind: method === 'tools/call' ? 'tool' : 'other',
        name: method === 'tools/call' ? (asString(params.name) ?? method) : method,
        start,
        end: start,
        status: 'error',
        error: 'No response received (timeout or crash)',
        toolName: method === 'tools/call' ? asString(params.name) : undefined,
        toolArgs: params.arguments,
        toolArgsRaw: params.arguments ? JSON.stringify(params.arguments) : undefined,
        attributes: { 'mcp.method': method, missingResult: true },
      })
    }
    spans.sort((a, b) => a.start - b.start)
    const first = spans[0]?.start ?? 0
    const last = spans.reduce((mx, s) => Math.max(mx, s.end), first)
    spans.unshift({
      id: rootId,
      kind: 'agent',
      name: serverName ? `MCP session · ${serverName}` : 'MCP session',
      start: first,
      end: last,
      status: 'ok',
      attributes: {},
    })
    return {
      id: '',
      name: name ?? (serverName ? `MCP · ${serverName}` : 'MCP log'),
      format: 'mcp',
      spans,
      tools,
      timingEstimated: estimated,
      meta: { server: serverName, toolOnly: true },
    }
  },
}
