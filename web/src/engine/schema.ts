/** A tiny JSON-Schema subset validator for tool arguments (type, required, enum, properties, items, additionalProperties). */
import type { JsonSchema } from './types'

export interface SchemaIssue {
  path: string
  message: string
  kind: 'missing' | 'type' | 'enum' | 'unknown-prop'
}

function typeOf(v: unknown): string {
  if (v === null) return 'null'
  if (Array.isArray(v)) return 'array'
  if (typeof v === 'number') return Number.isInteger(v) ? 'integer' : 'number'
  return typeof v
}

function typeMatches(v: unknown, t: string): boolean {
  const actual = typeOf(v)
  if (t === 'number') return actual === 'number' || actual === 'integer'
  return actual === t
}

export function validateArgs(
  value: unknown,
  schema: JsonSchema | undefined,
  path = '$',
): SchemaIssue[] {
  if (!schema || typeof schema !== 'object') return []
  const issues: SchemaIssue[] = []
  const types = schema.type ? (Array.isArray(schema.type) ? schema.type : [schema.type]) : []
  if (types.length && !types.some((t) => typeMatches(value, t))) {
    issues.push({
      path,
      kind: 'type',
      message: `expected ${types.join('|')}, got ${typeOf(value)}`,
    })
    return issues
  }
  if (schema.enum && !schema.enum.some((e) => JSON.stringify(e) === JSON.stringify(value))) {
    issues.push({
      path,
      kind: 'enum',
      message: `${JSON.stringify(value)} is not one of ${schema.enum.map((e) => JSON.stringify(e)).join(', ')}`,
    })
  }
  if (typeOf(value) === 'object') {
    const obj = value as Record<string, unknown>
    for (const req of schema.required ?? []) {
      if (!(req in obj) || obj[req] === undefined)
        issues.push({
          path: `${path}.${req}`,
          kind: 'missing',
          message: `missing required "${req}"`,
        })
    }
    const props = schema.properties ?? {}
    for (const [k, v] of Object.entries(obj)) {
      if (props[k]) issues.push(...validateArgs(v, props[k], `${path}.${k}`))
      else if (schema.additionalProperties === false)
        issues.push({
          path: `${path}.${k}`,
          kind: 'unknown-prop',
          message: `unexpected property "${k}"`,
        })
    }
  }
  if (typeOf(value) === 'array' && schema.items) {
    ;(value as unknown[]).forEach((v, i) =>
      issues.push(...validateArgs(v, schema.items, `${path}[${i}]`)),
    )
  }
  return issues
}
