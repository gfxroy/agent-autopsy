/** The monochrome Death Certificate: data (always redacted) + canvas renderer. */
import type { Analysis } from '../engine/analyze'
import { redactText } from '../engine/redact'
import { truncate } from '../engine/util'
import { causeSentence, plainSteps } from './plain'

export const SITE_URL = 'https://gfxroy.github.io/agent-autopsy/'

export interface CertificateData {
  status: 'alive' | 'injured' | 'dead'
  title: string
  deceased: string
  cause: string
  failingStep: string
  grade: string
  caseNo: string
  date: string
}

const clean = (s: string) => redactText(s).text.replace(/`/g, '')

export function localDate(d = new Date()): string {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
}

export function certificateData(a: Analysis, date = new Date()): CertificateData {
  const steps = plainSteps(a)
  const failed = steps.find((s) => s.failed)
  const status = a.verdict.status
  return {
    status,
    title: status === 'alive' ? 'Certificate of Health' : 'Certificate of Death',
    deceased: truncate(clean(a.trace.name || 'Unnamed agent'), 60),
    cause: truncate(clean(causeSentence(a)), 180),
    failingStep: failed
      ? truncate(clean(`Step ${failed.n} of ${steps.length}: ${failed.text}`), 90)
      : `None. All ${steps.length} steps completed.`,
    grade: a.grade,
    caseNo: a.trace.id.replace(/^t/, '').slice(0, 8).toUpperCase(),
    date: localDate(date),
  }
}

function wrap(ctx: CanvasRenderingContext2D, text: string, maxWidth: number): string[] {
  const out: string[] = []
  let line = ''
  for (const w of text.split(/\s+/)) {
    const next = line ? `${line} ${w}` : w
    if (ctx.measureText(next).width > maxWidth && line) {
      out.push(line)
      line = w
    } else line = next
  }
  if (line) out.push(line)
  return out
}

/** Draws the 1200×675 certificate. Returns false when no 2D context is available. */
export function drawCertificate(canvas: HTMLCanvasElement, d: CertificateData): boolean {
  canvas.width = 1200
  canvas.height = 675
  const ctx = canvas.getContext('2d')
  if (!ctx) return false
  const W = 1200
  const H = 675
  const serif = 'Georgia, "Times New Roman", serif'
  const sans = '-apple-system, "Segoe UI", Helvetica, Arial, sans-serif'
  const mono = 'ui-monospace, Menlo, Consolas, monospace'

  ctx.fillStyle = '#ffffff'
  ctx.fillRect(0, 0, W, H)
  ctx.strokeStyle = '#111111'
  ctx.lineWidth = 2
  ctx.strokeRect(28, 28, W - 56, H - 56)
  ctx.lineWidth = 0.75
  ctx.strokeRect(38, 38, W - 76, H - 76)

  ctx.fillStyle = '#111111'
  ctx.textAlign = 'center'
  ctx.font = `600 13px ${sans}`
  ctx.fillText('AGENT AUTOPSY', W / 2, 92)
  ctx.font = `400 50px ${serif}`
  ctx.fillText(d.title, W / 2, 152)
  ctx.fillStyle = '#d4d4d4'
  ctx.fillRect(W / 2 - 40, 178, 80, 1)

  const left = 100
  const field = (label: string, y: number) => {
    ctx.textAlign = 'left'
    ctx.fillStyle = '#737373'
    ctx.font = `600 12px ${sans}`
    ctx.fillText(label.toUpperCase(), left, y)
  }
  field('Agent', 232)
  ctx.fillStyle = '#111111'
  ctx.font = `400 26px ${serif}`
  ctx.fillText(d.deceased, left, 266)

  field(d.status === 'alive' ? 'Finding' : 'Cause of death', 318)
  ctx.font = `400 24px ${serif}`
  ctx.fillStyle = '#111111'
  const lines = wrap(ctx, d.cause, 760).slice(0, 3)
  lines.forEach((l, i) => ctx.fillText(l, left, 352 + i * 34))

  const y2 = 352 + lines.length * 34 + 24
  field(d.status === 'alive' ? 'Failing step' : 'Failing step', y2)
  ctx.fillStyle = '#111111'
  ctx.font = `400 19px ${sans}`
  ctx.fillText(d.failingStep, left, y2 + 30)

  // grade seal
  const cx = 1000
  const cy = 330
  ctx.strokeStyle = '#111111'
  ctx.lineWidth = 2
  ctx.beginPath()
  ctx.arc(cx, cy, 92, 0, Math.PI * 2)
  ctx.stroke()
  ctx.lineWidth = 0.75
  ctx.beginPath()
  ctx.arc(cx, cy, 82, 0, Math.PI * 2)
  ctx.stroke()
  ctx.textAlign = 'center'
  ctx.fillStyle = '#111111'
  ctx.font = `400 ${d.grade.length > 1 ? 76 : 92}px ${serif}`
  ctx.fillText(d.grade, cx, cy + 30)
  ctx.font = `600 11px ${sans}`
  ctx.fillStyle = '#737373'
  ctx.fillText('GRADE', cx, cy + 62)

  // footer
  ctx.fillStyle = '#d4d4d4'
  ctx.fillRect(left, H - 104, W - 2 * left, 1)
  ctx.font = `400 13px ${mono}`
  ctx.fillStyle = '#737373'
  ctx.textAlign = 'left'
  ctx.fillText(`Case ${d.caseNo}  ·  ${d.date}  ·  Personal data redacted`, left, H - 74)
  ctx.textAlign = 'right'
  ctx.fillText(SITE_URL.replace(/^https:\/\//, '').replace(/\/$/, ''), W - left, H - 74)
  return true
}
