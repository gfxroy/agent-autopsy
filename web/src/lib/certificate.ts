/** The shareable Death Certificate: data (always redacted) + canvas renderer + share text. */
import type { Analysis } from '../engine/analyze'
import { redactText } from '../engine/redact'
import { roastHeadline } from '../engine/roast'
import { fmtMs, fmtNum, fmtUsd, truncate } from '../engine/util'
import { todayKey } from '../game/rng'

export const SITE_URL = 'https://gfxroy.github.io/agent-autopsy/'

export interface CertificateData {
  status: 'alive' | 'injured' | 'dead'
  deceased: string
  cause: string
  timeOfDeath: string
  grade: string
  iq: number
  efficiency: string
  wasted: string
  cost: string
  tokens: string
  roast: string
  examiner: string
  caseNo: string
  date: string
}

const clean = (s: string) => redactText(s).text.replace(/`/g, '')

export function certificateData(a: Analysis, examiner: string, date = new Date()): CertificateData {
  const v = a.verdict
  const tod =
    v.status === 'alive'
      ? 'N/A — patient survived'
      : v.timeOfDeath !== undefined
        ? `T+${fmtMs(v.timeOfDeath)}${v.step ? ` · step ${v.step} of ${v.steps}` : ''}`
        : 'unknown'
  return {
    status: v.status,
    deceased: truncate(clean(a.trace.name || 'Unnamed agent'), 60),
    cause: truncate(clean(v.cause), 70),
    timeOfDeath: tod,
    grade: a.grade,
    iq: a.iq,
    efficiency: `${Math.round(a.efficiency * 100)}%`,
    wasted: fmtUsd(a.wastedUsd),
    cost: fmtUsd(a.totalCost),
    tokens: fmtNum(a.totalTokens),
    roast: truncate(clean(roastHeadline(a)), 140),
    examiner,
    caseNo: `#${a.trace.id.replace(/^t/, '').slice(0, 8).toUpperCase()}`,
    date: todayKey(date),
  }
}

export function shareText(d: CertificateData): string {
  const head =
    d.status === 'alive'
      ? '💚 My AI agent passed its autopsy. Pronounced ALIVE.'
      : d.status === 'injured'
        ? '🩹 My AI agent survived… barely.'
        : '☠️ My AI agent just died.'
  return [
    head,
    d.status === 'alive'
      ? `Grade ${d.grade} · Agent IQ ${d.iq} · ${d.efficiency} efficient`
      : `Cause of death: ${d.cause}`,
    d.status === 'alive' ? '' : `Time of death: ${d.timeOfDeath}`,
    d.status === 'alive' ? '' : `Grade ${d.grade} · Agent IQ ${d.iq} · ${d.wasted} wasted`,
    `Autopsy by ${SITE_URL} #AgentAutopsy`,
  ]
    .filter(Boolean)
    .join('\n')
}

function wrap(ctx: CanvasRenderingContext2D, text: string, maxWidth: number): string[] {
  const words = text.split(' ')
  const lines: string[] = []
  let line = ''
  for (const w of words) {
    const test = line ? `${line} ${w}` : w
    if (ctx.measureText(test).width > maxWidth && line) {
      lines.push(line)
      line = w
    } else line = test
  }
  if (line) lines.push(line)
  return lines
}

const GRADE_COLOR: Record<string, string> = {
  A: '#34d399',
  B: '#a3e635',
  C: '#fbbf24',
  D: '#fb923c',
  F: '#f43f5e',
}

export function drawCertificate(canvas: HTMLCanvasElement, d: CertificateData): boolean {
  const W = 1200
  const H = 675
  canvas.width = W
  canvas.height = H
  const ctx = canvas.getContext('2d')
  if (!ctx) return false
  const serif = 'Georgia, "Times New Roman", serif'
  const mono = '"JetBrains Mono", ui-monospace, Menlo, monospace'
  // Paper
  const g = ctx.createLinearGradient(0, 0, W, H)
  g.addColorStop(0, '#17130f')
  g.addColorStop(1, '#0d0b09')
  ctx.fillStyle = g
  ctx.fillRect(0, 0, W, H)
  ctx.globalAlpha = 0.05
  for (let y = 0; y < H; y += 4) {
    ctx.fillStyle = y % 8 ? '#fff' : '#000'
    ctx.fillRect(0, y, W, 1)
  }
  ctx.globalAlpha = 1
  // Frames
  ctx.strokeStyle = '#c9b98f'
  ctx.lineWidth = 3
  ctx.strokeRect(24, 24, W - 48, H - 48)
  ctx.lineWidth = 1
  ctx.strokeRect(36, 36, W - 72, H - 72)
  // Header
  ctx.fillStyle = '#e8dcc0'
  ctx.textAlign = 'center'
  ctx.font = `bold 46px ${serif}`
  const title =
    d.status === 'alive'
      ? 'CERTIFICATE OF GOOD HEALTH'
      : d.status === 'injured'
        ? 'CERTIFICATE OF INJURY'
        : 'CERTIFICATE OF DEATH'
  ctx.fillText(title, W / 2, 104)
  ctx.font = `italic 18px ${serif}`
  ctx.fillStyle = '#a89a78'
  ctx.fillText('Office of the Chief Medical Examiner for Artificial Agents', W / 2, 136)
  ctx.strokeStyle = '#5a4f3a'
  ctx.beginPath()
  ctx.moveTo(120, 156)
  ctx.lineTo(W - 120, 156)
  ctx.stroke()
  // Fields
  ctx.textAlign = 'left'
  const field = (label: string, value: string, y: number, color = '#f3ead6', size = 30) => {
    ctx.font = `600 14px ${mono}`
    ctx.fillStyle = '#8f8263'
    ctx.fillText(label.toUpperCase(), 90, y)
    ctx.font = `${size}px ${serif}`
    ctx.fillStyle = color
    const lines = wrap(ctx, value, 720)
    lines.slice(0, 2).forEach((l, i) => ctx.fillText(l, 90, y + 34 + i * (size + 6)))
    return lines.length > 1 ? size + 6 : 0
  }
  let y = 200
  y += field('Deceased', d.deceased, y)
  y += 82
  y += field(
    d.status === 'alive' ? 'Condition' : 'Cause of death',
    d.cause,
    y,
    d.status === 'alive' ? '#86efac' : '#fca5a5',
    32,
  )
  y += 84
  field('Time of death', d.timeOfDeath, y, '#f3ead6', 26)
  // Stats
  const stats: [string, string][] = [
    ['AGENT IQ', String(d.iq)],
    ['EFFICIENCY', d.efficiency],
    ['MONEY WASTED', d.wasted],
    ['TOTAL COST', d.cost],
    ['TOKENS', d.tokens],
  ]
  const sy = 498
  stats.forEach(([k, v], i) => {
    const x = 90 + i * 148
    ctx.font = `600 12px ${mono}`
    ctx.fillStyle = '#8f8263'
    ctx.fillText(k, x, sy)
    ctx.font = `bold 28px ${mono}`
    ctx.fillStyle = k === 'MONEY WASTED' ? '#fca5a5' : '#f3ead6'
    ctx.fillText(v, x, sy + 34)
  })
  // Roast
  ctx.font = `italic 19px ${serif}`
  ctx.fillStyle = '#c9b98f'
  wrap(ctx, `“${d.roast}”`, 760)
    .slice(0, 2)
    .forEach((l, i) => ctx.fillText(l, 90, 580 + i * 24))
  // Grade seal
  const cx = 980
  const cy = 300
  const color = GRADE_COLOR[d.grade[0]] ?? '#f3ead6'
  ctx.save()
  ctx.translate(cx, cy)
  ctx.rotate(-0.12)
  ctx.strokeStyle = color
  ctx.lineWidth = 6
  ctx.beginPath()
  ctx.arc(0, 0, 110, 0, Math.PI * 2)
  ctx.stroke()
  ctx.lineWidth = 2
  ctx.beginPath()
  ctx.arc(0, 0, 96, 0, Math.PI * 2)
  ctx.stroke()
  ctx.fillStyle = color
  ctx.textAlign = 'center'
  ctx.font = `bold 96px ${serif}`
  ctx.fillText(d.grade, 0, 32)
  ctx.font = `bold 14px ${mono}`
  ctx.fillText('AUTOPSY GRADE', 0, 66)
  ctx.restore()
  // Stamp
  ctx.save()
  ctx.translate(990, 470)
  ctx.rotate(-0.22)
  ctx.globalAlpha = 0.85
  const stamp = d.status === 'alive' ? 'ALIVE' : d.status === 'injured' ? 'WOUNDED' : 'DECEASED'
  ctx.strokeStyle = d.status === 'alive' ? '#22c55e' : '#e11d48'
  ctx.fillStyle = ctx.strokeStyle
  ctx.lineWidth = 5
  ctx.strokeRect(-130, -38, 260, 72)
  ctx.font = `bold 44px ${mono}`
  ctx.textAlign = 'center'
  ctx.fillText(stamp, 0, 15)
  ctx.restore()
  // Footer
  ctx.textAlign = 'left'
  ctx.font = `13px ${mono}`
  ctx.fillStyle = '#8f8263'
  ctx.fillText(`CASE ${d.caseNo} · ${d.date} · Certified by ${d.examiner}`, 90, 636)
  ctx.textAlign = 'right'
  ctx.fillText('gfxroy.github.io/agent-autopsy', W - 90, 636)
  return true
}
