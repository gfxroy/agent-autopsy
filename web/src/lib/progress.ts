/** XP, ranks, badges, streaks and the local leaderboard. Pure functions; persisted by the store. */

export interface BadgeDef {
  id: string
  icon: string
  name: string
  desc: string
}

export const BADGES: BadgeDef[] = [
  { id: 'first-autopsy', icon: '🩺', name: 'First Incision', desc: 'Autopsy your first trace.' },
  {
    id: 'own-trace',
    icon: '📂',
    name: 'Bring Your Own Body',
    desc: 'Import one of your own traces.',
  },
  { id: 'polyglot', icon: '🌐', name: 'Polyglot', desc: 'Autopsy traces in 4 different formats.' },
  { id: 'clean-bill', icon: '💚', name: 'Clean Bill of Health', desc: 'Find an A+ run.' },
  {
    id: 'forensic-accountant',
    icon: '💸',
    name: 'Forensic Accountant',
    desc: 'Find a run that wasted over half its tokens.',
  },
  { id: 'roast-master', icon: '🌶️', name: 'Roast Master', desc: 'Turn on Roast mode.' },
  { id: 'second-opinion', icon: '⚖️', name: 'Second Opinion', desc: 'Compare two runs in Diff.' },
  { id: 'notary', icon: '📜', name: 'Notary', desc: 'Download a death certificate.' },
  { id: 'loop-breaker', icon: '🔁', name: 'Loop Breaker', desc: 'Catch a loop in Spot the Bug.' },
  {
    id: 'injection-detective',
    icon: '🕵️',
    name: 'Injection Detective',
    desc: 'Catch a prompt injection in Spot the Bug.',
  },
  {
    id: 'schema-cop',
    icon: '👮',
    name: 'Schema Cop',
    desc: 'Catch invalid tool arguments in Spot the Bug.',
  },
  {
    id: 'ghostbuster',
    icon: '👻',
    name: 'Ghostbuster',
    desc: 'Catch a hallucinated tool in Spot the Bug.',
  },
  {
    id: 'bloat-buster',
    icon: '🎈',
    name: 'Bloat Buster',
    desc: 'Catch context bloat in Spot the Bug.',
  },
  { id: 'speed-demon', icon: '⚡', name: 'Speed Demon', desc: 'Solve a case in under 10 seconds.' },
  { id: 'on-fire', icon: '🔥', name: 'On Fire', desc: 'Reach a 3× combo.' },
  { id: 'unstoppable', icon: '🌋', name: 'Unstoppable', desc: 'Reach a 5× combo.' },
  { id: 'daily-doctor', icon: '📅', name: 'Daily Doctor', desc: 'Solve a daily case.' },
  { id: 'three-peat', icon: '🥉', name: 'Three-peat', desc: '3-day daily streak.' },
  { id: 'week-on-call', icon: '🏥', name: 'Week on Call', desc: '7-day daily streak.' },
  {
    id: 'board-certified',
    icon: '🎓',
    name: 'Board Certified',
    desc: 'Clear all 10 campaign cases.',
  },
  {
    id: 'chief-of-staff',
    icon: '👑',
    name: 'Chief of Staff',
    desc: '3 stars on every campaign case.',
  },
]

export const RANKS: { xp: number; title: string; icon: string }[] = [
  { xp: 0, title: 'Intern Coroner', icon: '🧑‍⚕️' },
  { xp: 300, title: 'Junior Pathologist', icon: '🔬' },
  { xp: 900, title: 'Resident Pathologist', icon: '🧪' },
  { xp: 2000, title: 'Forensic Investigator', icon: '🕵️' },
  { xp: 4000, title: 'Senior Coroner', icon: '⚰️' },
  { xp: 7000, title: 'Deputy Medical Examiner', icon: '🏛️' },
  { xp: 11000, title: 'Chief Medical Examiner', icon: '👑' },
]

export function rankFor(xp: number): {
  index: number
  title: string
  icon: string
  next?: { xp: number; title: string }
  progress: number
} {
  let index = 0
  for (let i = 0; i < RANKS.length; i++) if (xp >= RANKS[i].xp) index = i
  const cur = RANKS[index]
  const next = RANKS[index + 1]
  const progress = next ? (xp - cur.xp) / (next.xp - cur.xp) : 1
  return { index, title: cur.title, icon: cur.icon, next, progress }
}

export interface LeaderEntry {
  name: string
  score: number
  mode: 'daily' | 'campaign'
  date: string
  bot?: boolean
}

export interface Progress {
  xp: number
  badges: string[]
  formats: string[]
  autopsied: string[]
  campaign: Record<string, { stars: number; best: number }>
  daily: Record<string, { score: number; ms: number; correct: boolean }>
  streak: { current: number; best: number; last?: string }
  bestCombo: number
  leaderboard: LeaderEntry[]
  playerName: string
}

export const BOTS: LeaderEntry[] = [
  { name: 'gpt-4o-mini (bot)', score: 5200, mode: 'campaign', date: '', bot: true },
  { name: 'claude-haiku (bot)', score: 3900, mode: 'campaign', date: '', bot: true },
  { name: 'regex-v1 (bot)', score: 2100, mode: 'campaign', date: '', bot: true },
  { name: 'random-clicker (bot)', score: 600, mode: 'daily', date: '', bot: true },
]

export function emptyProgress(): Progress {
  return {
    xp: 0,
    badges: [],
    formats: [],
    autopsied: [],
    campaign: {},
    daily: {},
    streak: { current: 0, best: 0 },
    bestCombo: 0,
    leaderboard: [],
    playerName: 'You',
  }
}

export type ProgressEvent =
  | { type: 'xp'; amount: number; reason: string }
  | { type: 'badge'; badge: BadgeDef }
  | { type: 'rank'; title: string; icon: string }

export class ProgressTx {
  events: ProgressEvent[] = []
  p: Progress
  constructor(p: Progress) {
    this.p = structuredClone(p)
  }
  xp(amount: number, reason: string): this {
    if (amount <= 0) return this
    const before = rankFor(this.p.xp).index
    this.p.xp += Math.round(amount)
    this.events.push({ type: 'xp', amount: Math.round(amount), reason })
    const after = rankFor(this.p.xp)
    if (after.index > before)
      this.events.push({ type: 'rank', title: after.title, icon: after.icon })
    return this
  }
  badge(id: string): this {
    if (this.p.badges.includes(id)) return this
    const def = BADGES.find((b) => b.id === id)
    if (!def) return this
    this.p.badges.push(id)
    this.events.push({ type: 'badge', badge: def })
    this.xp(150, `Badge: ${def.name}`)
    return this
  }
}

/** Called whenever a trace's autopsy is shown. */
export function onAutopsy(
  p: Progress,
  info: { id: string; format: string; own: boolean; grade: string; efficiency: number },
): ProgressTx {
  const tx = new ProgressTx(p)
  if (!tx.p.autopsied.includes(info.id)) {
    tx.p.autopsied.push(info.id)
    tx.xp(info.own ? 100 : 40, info.own ? 'Autopsied your own trace' : 'New autopsy')
  }
  if (!tx.p.formats.includes(info.format)) tx.p.formats.push(info.format)
  tx.badge('first-autopsy')
  if (info.own) tx.badge('own-trace')
  if (tx.p.formats.length >= 4) tx.badge('polyglot')
  if (info.grade === 'A+') tx.badge('clean-bill')
  if (info.efficiency < 0.5) tx.badge('forensic-accountant')
  return tx
}

export const RULE_BADGE: Record<string, string> = {
  loop: 'loop-breaker',
  'prompt-injection': 'injection-detective',
  'invalid-args': 'schema-cop',
  'unknown-tool': 'ghostbuster',
  'context-bloat': 'bloat-buster',
}

export function dayDiff(a: string, b: string): number {
  return Math.round((Date.parse(`${b}T00:00:00Z`) - Date.parse(`${a}T00:00:00Z`)) / 86_400_000)
}

export interface GameResult {
  mode: 'daily' | 'campaign'
  levelId: number
  date: string
  correct: boolean
  ms: number
  wrong: number
  hinted: boolean
  combo: number
  score: number
  rule: string
}

/** Score for a solved case: base × difficulty, time bonus, combo multiplier, penalties. */
export function scoreCase(
  difficulty: number,
  ms: number,
  wrong: number,
  hinted: boolean,
  combo: number,
): number {
  const base = 400 + difficulty * 200
  const timeBonus = Math.max(0, 1 - ms / 90_000) // full bonus at 0s, none at 90s
  const mult = combo >= 5 ? 3 : combo >= 3 ? 2 : combo >= 2 ? 1.5 : 1
  const raw =
    (base + base * timeBonus) * mult * Math.max(0.25, 1 - wrong * 0.25) * (hinted ? 0.7 : 1)
  return Math.round(raw / 10) * 10
}

export function starsFor(ms: number, wrong: number, hinted: boolean): number {
  if (wrong === 0 && !hinted && ms < 30_000) return 3
  if (wrong <= 1 && ms < 60_000) return 2
  return 1
}

export function onGameResult(p: Progress, r: GameResult, campaignSize = 10): ProgressTx {
  const tx = new ProgressTx(p)
  if (!r.correct) return tx
  tx.xp(r.score / 10, r.mode === 'daily' ? 'Daily case solved' : `Case ${r.levelId} solved`)
  tx.p.bestCombo = Math.max(tx.p.bestCombo, r.combo)
  if (RULE_BADGE[r.rule]) tx.badge(RULE_BADGE[r.rule])
  if (r.ms < 10_000) tx.badge('speed-demon')
  if (r.combo >= 3) tx.badge('on-fire')
  if (r.combo >= 5) tx.badge('unstoppable')
  if (r.mode === 'campaign') {
    const key = String(r.levelId)
    const prev = tx.p.campaign[key]
    const stars = starsFor(r.ms, r.wrong, r.hinted)
    tx.p.campaign[key] = {
      stars: Math.max(prev?.stars ?? 0, stars),
      best: Math.max(prev?.best ?? 0, r.score),
    }
    const done = Object.keys(tx.p.campaign).length
    if (done >= campaignSize) tx.badge('board-certified')
    if (done >= campaignSize && Object.values(tx.p.campaign).every((c) => c.stars === 3))
      tx.badge('chief-of-staff')
    const total = Object.values(tx.p.campaign).reduce((a, c) => a + c.best, 0)
    upsertLeader(tx.p, { name: tx.p.playerName, score: total, mode: 'campaign', date: r.date })
  } else if (!tx.p.daily[r.date]) {
    tx.p.daily[r.date] = { score: r.score, ms: r.ms, correct: true }
    const last = tx.p.streak.last
    tx.p.streak.current =
      last && dayDiff(last, r.date) === 1
        ? tx.p.streak.current + 1
        : last === r.date
          ? tx.p.streak.current
          : 1
    tx.p.streak.last = r.date
    tx.p.streak.best = Math.max(tx.p.streak.best, tx.p.streak.current)
    tx.badge('daily-doctor')
    if (tx.p.streak.current >= 3) tx.badge('three-peat')
    if (tx.p.streak.current >= 7) tx.badge('week-on-call')
    upsertLeader(tx.p, { name: tx.p.playerName, score: r.score, mode: 'daily', date: r.date })
  }
  return tx
}

function upsertLeader(p: Progress, e: LeaderEntry): void {
  const i = p.leaderboard.findIndex(
    (x) => x.mode === e.mode && (e.mode === 'campaign' || x.date === e.date),
  )
  if (i >= 0) p.leaderboard[i] = { ...e, score: Math.max(e.score, p.leaderboard[i].score) }
  else p.leaderboard.push(e)
  p.leaderboard.sort((a, b) => b.score - a.score)
  p.leaderboard = p.leaderboard.slice(0, 50)
}

export function leaderboard(p: Progress, mode: 'daily' | 'campaign'): LeaderEntry[] {
  return [...p.leaderboard.filter((e) => e.mode === mode), ...BOTS.filter((b) => b.mode === mode)]
    .sort((a, b) => b.score - a.score)
    .slice(0, 10)
}
