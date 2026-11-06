import { atom, read, update } from 'claude-code'
import type { EngineInterface, Register, SessionContextUsage, SessionCost, SessionRateLimit, Timer } from 'claude-code'

import type { Attachment, BoardInfo, Chronicle, Finding, Live, LogEntry, Peer, Station, Team, ToolSize, Usage, Worker } from '../types'
import {
  ago,
  boardNote,
  clipDiff,
  COMPACT_MARK,
  compactInstructions,
  conflictsFor,
  conflictText,
  EMPTY_BOARD,
  filesLine,
  FINDING_SUMMARY,
  FINDING_WINDOW_MS,
  findingText,
  heldWriteText,
  matchingFinding,
  parseChronicle,
  parseFindings,
  pathKey,
  statusWord,
  titleOf,
  withFile,
  withTask,
} from './board'
import { officeAlt, officeSvg } from './scene'
import type { CacheGauge } from './scene'
import {
  approxTokens,
  callLabel,
  EMPTY_TOKENS,
  fixedLoad,
  fromUsage,
  hitPercent,
  kilo,
  learnTtl,
  warmth,
  warmthText,
  withOutput,
  withTurn,
} from './tokens'

const PANE = 'pixel-ofis'
const TITLE = 'Piksel Ofis'

const MAIN: Worker = {
  id: 'main',
  name: 'Şef',
  role: 'ana oturum',
  status: 'idle',
  station: 'coffee',
  tool: null,
  task: '',
  tools: 0,
  startedAt: 0,
}

// Change a tag when that value's fields change: an earlier version's value
// outlives a reload and is then read as the initial one.
const workers = atom({ plugin: 'pixel-ofis', key: 'workers' } as const, [MAIN], { shape: 'workers-1' })
const log = atom({ plugin: 'pixel-ofis', key: 'log' } as const, [], { shape: 'log-1' })
const usage = atom({ plugin: 'pixel-ofis', key: 'usage' } as const, null, { shape: 'usage-1' })
const live = atom({ plugin: 'pixel-ofis', key: 'live' } as const, { slot: null, peers: [] }, { shape: 'live-2' })
const board = atom({ plugin: 'pixel-ofis', key: 'board' } as const, EMPTY_BOARD, { shape: 'board-1' })
const history = atom({ plugin: 'pixel-ofis', key: 'history' } as const, [], { shape: 'history-1' })
const attachments = atom({ plugin: 'pixel-ofis', key: 'attachments' } as const, [], { shape: 'attachments-1' })
const rounds = atom({ plugin: 'pixel-ofis', key: 'rounds' } as const, { task: 0, attach: 0, name: 0, defer: 0 }, { shape: 'rounds-3' })
const canFill = atom({ plugin: 'pixel-ofis', key: 'canFill' } as const, true, { shape: 'can-fill-1' })
const tokens = atom({ plugin: 'pixel-ofis', key: 'tokens' } as const, EMPTY_TOKENS, { shape: 'tokens-1' })
const load = atom({ plugin: 'pixel-ofis', key: 'load' } as const, null, { shape: 'load-1' })
const findings = atom({ plugin: 'pixel-ofis', key: 'findings' } as const, [], { shape: 'findings-1' })
const deferred = atom({ plugin: 'pixel-ofis', key: 'deferred' } as const, [], { shape: 'deferred-1' })
const toolSizes = atom({ plugin: 'pixel-ofis', key: 'toolSizes' } as const, [], { shape: 'tool-sizes-1' })
const cacheTtl = atom({ plugin: 'pixel-ofis', key: 'cacheTtl' } as const, null, { shape: 'cache-ttl-1' })

// Kept across sessions in the plugin's store.
const STORE_DEFERRED = 'deferredTools'
const STORE_TTL = 'cacheTtlMs'
// The pane offers a compaction from this share of the context window on.
const COMPACT_OFFER_PERCENT = 60
// And says so once, in a toast, from this share on.
const COMPACT_HINT_PERCENT = 70
// A subagent's answer shorter than this is no report worth keeping.
const MIN_FINDING_CHARS = 200
const FINDINGS_KEPT = 10
const FINDINGS_SHOWN = 12
// ToolSearch loads the deferred tools: it can never wait behind itself.
const NEVER_DEFERRED = new Set(['ToolSearch'])

// Every chat writes its team to a slot file of one folder and reads the others':
// a fixed pool, so nothing has to be deleted when a chat goes away.
const SLOT_COUNT = 12
const TICK_MS = 3000
const HEARTBEAT_MS = 10000
const STALE_MS = 45000
const MAX_ATTACHMENTS = 8
const RESEND_GUARD_MS = 15000
// The journal folder is read every tenth tick: ended chats change seldom.
const HISTORY_EVERY = 10
const REDRAW_EVERY = 20
const HISTORY_SPAN_MS = 24 * 60 * 60 * 1000
const HISTORY_SHOWN = 6
// A conflict note after an Edit is repeated for one path at most this often.
const CONFLICT_NOTE_MS = 10 * 60 * 1000

const EDIT_TOOLS = new Set(['Edit', 'Write', 'MultiEdit', 'NotebookEdit'])
const MESSAGE_TOOL = 'mcp__pixel-ofis__ofis_mesaj'

const TEAM_COLORS = ['#4fd1ff', '#ff7ab6', '#9dff6a', '#ffb347', '#c39bff', '#ff6b6b']
const SELF_COLOR = '#ffd700'
const IMAGE = /\.(png|jpe?g|gif|webp|bmp)$/i

type Snapshot = BoardInfo & { sessionId: string; project: string; task: string; workers: Worker[]; updatedAt: number; ended?: true }

type Link = {
  dir: string
  sessionId: string
  project: string
  startedAt: number
  lastText: string
  lastAt: number
  lastJournal: string
  ticks: number
  failed: boolean
}

// Module values start over on a reload, when `session.start` sets them again.
let link: Link | null = null
let timer: Timer | null = null
let draft = ''
let lastSent = { text: '', at: 0 }
// The board note the model last read, so an unchanged board costs no tokens again,
// and whether it was told how to message another chat in this conversation.
let lastNote = ''
let howToSaid = false
// Paths whose overwrite was held back once, and when a conflict note was last added.
const heldWrites = new Set<string>()
const notedAt = new Map<string, number>()
// The subagents this chat started, by id: the brief a finished report answers.
const briefs = new Map<string, { type: string; description: string; prompt: string }>()
// Agent calls held back once for another chat's report: the finding and the brief.
const heldAgents = new Set<string>()
// When the main loop's current turn started, and how full the context was then.
let turnStartedAt = 0
let contextAtStart: number | null = null
let compactHinted = false

const ROLE_NAMES: Record<string, string> = {
  'general-purpose': 'Usta',
  Explore: 'Kaşif',
  Plan: 'Mimar',
  fork: 'İkiz',
  'claude-code-guide': 'Rehber',
  'web-fetch': 'Muhabir',
}

const STATIONS: Record<string, Station> = {
  Read: 'shelf',
  Grep: 'shelf',
  Glob: 'shelf',
  LSP: 'shelf',
  Edit: 'desk',
  Write: 'desk',
  MultiEdit: 'desk',
  NotebookEdit: 'desk',
  Bash: 'terminal',
  PowerShell: 'terminal',
  Monitor: 'terminal',
  BashOutput: 'terminal',
  KillShell: 'terminal',
  TaskStop: 'terminal',
  WebFetch: 'web',
  WebSearch: 'web',
  Agent: 'board',
  Task: 'board',
  TodoWrite: 'board',
  Skill: 'board',
  ToolSearch: 'board',
  EnterPlanMode: 'board',
  ExitPlanMode: 'board',
  AskUserQuestion: 'board',
}

function stationOf(tool: string): Station {
  if (STATIONS[tool]) return STATIONS[tool]
  if (tool.startsWith('mcp__')) return 'web'

  return 'desk'
}

const clip = (text: string, max: number): string => {
  const flat = text.replace(/\s+/g, ' ').trim()

  return flat.length > max ? `${flat.slice(0, max - 1)}…` : flat
}

// A task's first written line: what the board shows, without the attachment list.
const headline = (text: string): string => text.split(/\r?\n/).find(line => line.trim()) ?? ''

const baseName = (path: string): string => path.replace(/[\\/]+$/, '').split(/[\\/]/).pop() ?? path

function toUsage(context: SessionContextUsage, rateLimits: SessionRateLimit[], cost: SessionCost | undefined): Usage {
  return {
    contextPercent: context.percent ?? null,
    contextTokens: context.tokens ?? null,
    contextWindow: context.window,
    limits: rateLimits.map(limit => ({ kind: limit.kind, percentUsed: limit.percentUsed, resetsAt: limit.resetsAt ?? null })),
    usd: cost?.usd ?? null,
  }
}

async function note($: EngineInterface, who: string, text: string): Promise<void> {
  const at = await $.clock.now()
  await update($, log, list => [...list, { at, who, text } satisfies LogEntry].slice(-6))
}

async function nameFor($: EngineInterface, role: string): Promise<string> {
  const base = ROLE_NAMES[role] ?? clip(role, 8)
  const same = (await read($, workers)).filter(worker => worker.role === role).length

  return same === 0 ? base : `${base} ${same + 1}`
}

// Applies `change` to the worker `id`, hiring it first when it is not on the floor yet.
async function touch($: EngineInterface, id: string, change: (worker: Worker) => Worker, hire?: Worker): Promise<void> {
  await update($, workers, list => {
    if (list.some(worker => worker.id === id)) return list.map(worker => (worker.id === id ? change(worker) : worker))

    return hire ? [...list, change(hire)] : list
  })
}

async function hireHelper($: EngineInterface, role: string, description: string, agentId: string): Promise<void> {
  const name = await nameFor($, role)
  const at = await $.clock.now()
  const hire: Worker = {
    id: agentId,
    name,
    role,
    status: 'working',
    station: 'board',
    tool: null,
    task: clip(description, 60),
    tools: 0,
    startedAt: at,
  }
  await touch($, agentId, worker => ({ ...worker, name, role, task: hire.task }), hire)
  await note($, name, `işe başladı: ${clip(description, 40)}`)
}

// ---- Other chats: the shared live folder -------------------------------------------

const slotPath = (dir: string, slot: number): string => `${dir}/slot-${slot}.json`

function parseSnapshot(text: string): Snapshot | null {
  try {
    const value = JSON.parse(text) as Partial<Snapshot>
    if (typeof value.sessionId !== 'string' || typeof value.updatedAt !== 'number' || !Array.isArray(value.workers)) return null

    return { project: '', task: '', ...EMPTY_BOARD, ...value } as Snapshot
  } catch {
    return null
  }
}

const journalDir = (dir: string): string => `${dir}/journal`
const journalPath = (dir: string, sessionId: string): string => `${journalDir(dir)}/${sessionId}.json`

// The chat's lasting entry on the board: written when what it is or did changes.
async function writeJournal($: EngineInterface, ended = false): Promise<void> {
  if (!link) return
  const info = await read($, board)
  const { slot } = await read($, live)
  const body = {
    sessionId: link.sessionId,
    label: slot === null ? '' : `#${slot + 1}`,
    project: link.project,
    startedAt: link.startedAt,
    ...info,
    ...(ended ? { ended: true as const } : {}),
  }
  const text = JSON.stringify(body)
  if (text === link.lastJournal) return
  await $.fs.write(journalPath(link.dir, link.sessionId), JSON.stringify({ ...body, updatedAt: await $.clock.now() }))
  link.lastJournal = text
}

async function changeBoard($: EngineInterface, change: (info: BoardInfo) => BoardInfo): Promise<void> {
  await update($, board, change)
  await writeJournal($).catch((error: unknown) => $.ui.log(`Pano günlüğü yazılamadı: ${error instanceof Error ? error.message : String(error)}`))
}

// Ended or silent chats of the last day, newest first: the board's history.
async function readHistory($: EngineInterface, now: number, liveIds: Set<string>): Promise<Chronicle[]> {
  if (!link) return []
  const dir = journalDir(link.dir)
  const entries = (await $.fs.list(dir).catch(() => []))
    .filter(entry => entry.kind === 'file' && entry.name.endsWith('.json') && now - entry.mtimeMs < HISTORY_SPAN_MS)
    .filter(entry => !liveIds.has(entry.name.slice(0, -5)))
    .sort((a, b) => b.mtimeMs - a.mtimeMs)
    .slice(0, HISTORY_SHOWN)
  const found: Chronicle[] = []
  for (const entry of entries) {
    const text = await $.fs.read(`${dir}/${entry.name}`).catch(() => '')
    const past = typeof text === 'string' ? parseChronicle(text) : null
    if (past && !liveIds.has(past.sessionId)) found.push(past)
  }

  return found
}

const findingsDir = (dir: string): string => `${dir}/findings`

// The other chats' subagent reports of the last two hours, newest first.
async function readFindings($: EngineInterface, now: number): Promise<Finding[]> {
  if (!link) return []
  const dir = findingsDir(link.dir)
  const own = `${link.sessionId}.json`
  const entries = (await $.fs.list(dir).catch(() => [])).filter(
    entry => entry.kind === 'file' && entry.name.endsWith('.json') && entry.name !== own && now - entry.mtimeMs < FINDING_WINDOW_MS,
  )
  const found: Finding[] = []
  for (const entry of entries) {
    const text = await $.fs.read(`${dir}/${entry.name}`).catch(() => '')
    if (typeof text === 'string') found.push(...parseFindings(text).filter(one => now - one.at < FINDING_WINDOW_MS))
  }

  return found.sort((a, b) => b.at - a.at).slice(0, FINDINGS_SHOWN)
}

// A finished subagent's report, kept in this chat's findings file for the others.
async function saveFinding($: EngineInterface, agentId: string, answer: string): Promise<void> {
  const brief = briefs.get(agentId)
  if (!link || !brief) return
  briefs.delete(agentId)
  const { slot } = await read($, live)
  const path = `${findingsDir(link.dir)}/${link.sessionId}.json`
  const before = await $.fs.read(path).catch(() => '')
  const kept = typeof before === 'string' ? parseFindings(before) : []
  const finding: Finding = {
    id: `${link.sessionId}:${agentId}`,
    sessionId: link.sessionId,
    label: slot === null ? '' : `#${slot + 1}`,
    project: link.project,
    type: brief.type,
    description: clip(brief.description, 80),
    prompt: clip(brief.prompt, 600),
    summary: answer.trim().slice(0, FINDING_SUMMARY),
    at: await $.clock.now(),
  }
  await $.fs.write(path, JSON.stringify([finding, ...kept.filter(one => one.id !== finding.id)].slice(0, FINDINGS_KEPT)))
}

// The file's uncommitted changes, as git tells them; nothing when git cannot.
async function fileDiff($: EngineInterface, path: string): Promise<string> {
  const dir = path.replace(/[\\/][^\\/]*$/, '') || '.'
  const ran = await $.process
    .run(['git', '-C', dir, 'diff', '--no-color', '--unified=2', '--', path], { timeoutMs: 5000 })
    .catch(() => null)
  if (!ran || ran.exitCode !== 0) return ''

  return clipDiff(ran.stdout)
}

async function readSlots($: EngineInterface, dir: string): Promise<(Snapshot | null)[]> {
  const slots: (Snapshot | null)[] = Array.from({ length: SLOT_COUNT }, () => null)
  const names = new Set((await $.fs.list(dir).catch(() => [])).map(entry => entry.name))
  for (let slot = 0; slot < SLOT_COUNT; slot += 1) {
    if (!names.has(`slot-${slot}.json`)) continue
    const text = await $.fs.read(slotPath(dir, slot)).catch(() => '')
    slots[slot] = typeof text === 'string' ? parseSnapshot(text) : null
  }

  return slots
}

const isFresh = (snap: Snapshot | null, now: number): snap is Snapshot =>
  snap !== null && !snap.ended && now - snap.updatedAt < STALE_MS

async function writeSlot($: EngineInterface, slot: number, now: number, ended: boolean): Promise<void> {
  if (!link) return
  const team = await read($, workers)
  const info = await read($, board)
  const body = {
    sessionId: link.sessionId,
    project: link.project,
    task: team.find(worker => worker.id === 'main')?.task ?? '',
    workers: team,
    ...info,
    ...(ended ? { ended: true as const } : {}),
  }
  const text = JSON.stringify(body)
  // Unchanged teams are written only as a heartbeat, so the folder is not churned.
  if (!ended && text === link.lastText && now - link.lastAt < HEARTBEAT_MS) return
  await $.fs.write(slotPath(link.dir, slot), JSON.stringify({ ...body, updatedAt: now }))
  link.lastText = text
  link.lastAt = now
}

async function tick($: EngineInterface): Promise<void> {
  if (!link) return
  const now = await $.clock.now()
  // After a /clear the process goes on under another id: it then claims afresh.
  const sessionId = await $.session.id()
  if (sessionId !== link.sessionId) {
    link.sessionId = sessionId
    link.lastText = ''
    await update($, live, held => ({ ...held, slot: null }))
  }
  const snaps = await readSlots($, link.dir)
  let { slot } = await read($, live)
  // Two chats that took one slot together: the one whose write stands keeps it.
  if (slot !== null) {
    const there = snaps[slot]
    if (there && isFresh(there, now) && there.sessionId !== link.sessionId) slot = null
  }
  if (slot === null) {
    const own = snaps.findIndex(snap => snap?.sessionId === link?.sessionId)
    const free = own >= 0 ? own : snaps.findIndex(snap => !isFresh(snap, now))
    if (free >= 0) {
      slot = free
      link.lastText = ''
    }
  }
  if (slot !== null) await writeSlot($, slot, now, false)

  const peers: Peer[] = []
  snaps.forEach((snap, index) => {
    if (index === slot || !isFresh(snap, now) || snap.sessionId === link?.sessionId) return
    const { sessionId, project, task, workers: crew, name, purpose, tasks, files } = snap
    peers.push({ sessionId, slot: index, project, task, workers: crew, name, purpose, tasks, files })
  })
  const next: Live = { slot, peers }
  const held = await read($, live)
  // Only a change redraws the pane: a heartbeat alone moves nothing.
  if (JSON.stringify(held) !== JSON.stringify(next)) {
    await update($, live, () => next)
    // The journal carries the chat's label: it follows a new slot.
    if (held.slot !== slot) await writeJournal($)
  }

  if (link.ticks % HISTORY_EVERY === 0) {
    const liveIds = new Set([link.sessionId, ...peers.map(peer => peer.sessionId)])
    const past = await readHistory($, now, liveIds)
    if (JSON.stringify(past) !== JSON.stringify(await read($, history))) await update($, history, () => past)
    const reports = await readFindings($, now)
    if (JSON.stringify(reports) !== JSON.stringify(await read($, findings))) await update($, findings, () => reports)
  }
  // The cache's clock and the limits' countdowns move with time alone: a redraw a minute.
  if (link.ticks % REDRAW_EVERY === 0) $.ui.invalidate('ui.render')
  link.ticks += 1
}

function startLive($: EngineInterface): void {
  timer?.cancel()
  const run = (): void => {
    void tick($).catch((error: unknown) => {
      if (link && !link.failed) {
        link.failed = true
        $.ui.log(`Diğer sohbetler okunamadı: ${error instanceof Error ? error.message : String(error)}`)
      }
    })
  }
  timer = $.clock.every(TICK_MS, run)
  run()
}

// ---- Tasks and attachments ---------------------------------------------------------

function compose(text: string, files: Attachment[]): string {
  if (files.length === 0) return text
  const list = files.map(file => `- ${file.path}`).join('\n')

  return `${text}\n\nEkler (Read aracıyla aç):\n${list}`
}

// A pasted path list: quoted paths ("Copy as path"), else one per line or `;`.
function parsePaths(value: string): string[] {
  const quoted = [...value.matchAll(/"([^"]+)"/g)].map(match => (match[1] ?? '').trim())
  const raw = quoted.length > 0 ? quoted : value.split(/\r?\n|;/)

  return raw.map(path => path.trim()).filter(Boolean)
}

async function addFiles($: EngineInterface, paths: string[]): Promise<void> {
  const added: Attachment[] = []
  const missing: string[] = []
  for (const path of paths) {
    const stat = await $.fs.stat(path).catch(() => null)
    if (stat?.kind === 'file') added.push({ path, name: baseName(path) })
    else missing.push(baseName(path))
  }
  let dropped = 0
  await update($, attachments, list => {
    const merged = [...list]
    for (const file of added) if (!merged.some(one => one.path === file.path)) merged.push(file)
    dropped = Math.max(0, merged.length - MAX_ATTACHMENTS)

    return merged.slice(0, MAX_ATTACHMENTS)
  })
  if (missing.length > 0) void $.ui.toast(`Dosya bulunamadı: ${missing.join(', ')}`)
  else if (dropped > 0) void $.ui.toast(`En fazla ${MAX_ATTACHMENTS} ek eklenebilir.`)
  else if (added.length > 0) void $.ui.toast(`${added.length} ek eklendi.`)
}

async function latestScreenshot($: EngineInterface): Promise<string | null> {
  const home = (await $.env.get('USERPROFILE')) ?? (await $.env.get('HOME'))
  if (!home) return null
  const dirs = [
    `${home}\\Pictures\\Screenshots`,
    `${home}\\OneDrive\\Pictures\\Screenshots`,
    `${home}\\OneDrive\\Resimler\\Ekran Görüntüleri`,
  ]
  let best: { path: string; mtimeMs: number } | null = null
  for (const dir of dirs) {
    for (const entry of await $.fs.list(dir).catch(() => [])) {
      if (entry.kind !== 'file' || !IMAGE.test(entry.name)) continue
      if (!best || entry.mtimeMs > best.mtimeMs) best = { path: `${dir}\\${entry.name}`, mtimeMs: entry.mtimeMs }
    }
  }

  return best?.path ?? null
}

async function clearComposer($: EngineInterface): Promise<void> {
  draft = ''
  await update($, attachments, () => [])
  await update($, rounds, held => ({ ...held, task: held.task + 1 }))
}

async function sendTask($: EngineInterface, value: string): Promise<void> {
  const text = value.trim()
  if (!text) {
    void $.ui.toast('Önce görevi yaz.')

    return
  }
  const now = await $.clock.now()
  // Enter pressed again on a task already on its way would send it twice.
  if (text === lastSent.text && now - lastSent.at < RESEND_GUARD_MS) {
    void $.ui.toast('Bu görev az önce gönderildi.')

    return
  }
  lastSent = { text, at: now }
  const files = await read($, attachments)
  const isBusy = (await read($, workers)).find(worker => worker.id === 'main')?.status === 'working'
  await clearComposer($)
  const extra = files.length > 0 ? ` (+${files.length} ek)` : ''
  await note($, 'Sen', `${isBusy ? 'sıraya aldın' : 'görev verdin'}: ${clip(text, 40)}${extra}`)
  void $.ui.toast(isBusy ? 'Görev sıraya alındı: Şef elindeki işi bitirince başlar.' : 'Görev Şef’e iletildi.')
  void $.prompt.submit({ text: compose(text, files), asUser: true }).catch((error: unknown) => {
    lastSent = { text: '', at: 0 }
    void $.ui.toast(`Görev gönderilemedi: ${error instanceof Error ? error.message : String(error)}`)
  })
}

async function toComposer($: EngineInterface): Promise<void> {
  const text = draft.trim()
  const files = await read($, attachments)
  if (!text && files.length === 0) {
    void $.ui.toast('Aktarılacak görev ya da ek yok.')

    return
  }
  const filled = await $.prompt.fill({ text: compose(text, files), mode: 'replace' })
  if (filled.isFilled) {
    await clearComposer($)
    void $.ui.toast('Sohbet kutusuna aktarıldı: oradan Enter ile gönder.')

    return
  }
  if (filled.refusal === 'no_composer') await update($, canFill, () => false)
  const why = filled.refusal === 'dialog' ? ': açık bir pencere var' : filled.refusal === 'no_composer' ? ': bu ekranda desteklenmiyor' : ''
  void $.ui.toast(`Sohbet kutusuna aktarılamadı${why}.`)
}

function teamsOf(own: Worker[], info: BoardInfo, held: Live): Team[] {
  const self: Team = {
    label: held.slot === null ? '' : `#${held.slot + 1}`,
    color: SELF_COLOR,
    isSelf: true,
    title: titleOf(info),
    task: own.find(worker => worker.id === 'main')?.task ?? '',
    files: info.files.length,
    workers: own,
  }
  const others = held.peers.map(
    (peer, i): Team => ({
      label: `#${peer.slot + 1}`,
      color: TEAM_COLORS[i % TEAM_COLORS.length] ?? SELF_COLOR,
      isSelf: false,
      title: titleOf(peer),
      task: peer.task,
      files: peer.files.length,
      workers: peer.workers,
    }),
  )

  return [self, ...others]
}

function teamLine(team: Team): string {
  const chief = team.workers.find(worker => worker.id === 'main')
  const helpers = team.workers.filter(worker => worker.id !== 'main' && worker.status === 'working').length
  const doing = chief?.status === 'working' && chief.tool ? `çalışıyor (${chief.tool})` : statusWord(chief?.status)
  const crew = helpers > 0 ? `, ${helpers} yardımcı` : ''
  const who = team.isSelf ? `${team.label} bu sohbet`.trim() : team.label

  return `${who} · ${doing}${crew} · ${team.title}`
}

// The second line of a chat's board entry: what it is on now and what it changed.
function detailLine(task: string, info: BoardInfo, project: string): string {
  const now = task && task !== info.purpose ? `şimdi: ${task}` : ''
  const purpose = info.name && info.purpose ? `amaç: ${info.purpose}` : ''
  const files = filesLine(info.files, project, 4)

  return [purpose, now, files ? `dosyalar: ${files}` : ''].filter(Boolean).join(' · ')
}

// What the model reads after it changes a file: the board, only when it changed since
// the model last read it. A turn that only reads or talks is told nothing.
async function freshNote($: EngineInterface): Promise<string | null> {
  const held = await read($, live)
  const label = held.slot === null ? '' : `#${held.slot + 1}`
  const now = await $.clock.now()
  const info = await read($, board)
  const past = await read($, history)
  // Compared without the how-to line, which is said once and is no change of the board.
  const bare = boardNote(label, info, held.peers, past, now, false)
  if (!bare || bare === lastNote) return null
  lastNote = bare
  const note = howToSaid ? bare : boardNote(label, info, held.peers, past, now, true)
  howToSaid = true

  return note
}

// The conversation was summarized: what the model had read of the board is gone.
function forgetNotes(): void {
  lastNote = ''
  howToSaid = false
  notedAt.clear()
}

async function compactNow($: EngineInterface): Promise<void> {
  const instructions = compactInstructions(await read($, board), link?.project ?? '') ?? undefined
  try {
    const done = await $.session.compact(instructions ? { instructions } : {})
    if ('skip' in done && typeof done.skip === 'string') {
      void $.ui.toast(`Sıkıştırılmadı: ${done.skip}`)

      return
    }
    forgetNotes()
    compactHinted = false
    await note($, 'Pano', 'sohbet pano özetiyle sıkıştırıldı')
    void $.ui.toast('Sohbet pano özetiyle sıkıştırıldı.')
  } catch (error) {
    const busy = (await read($, workers)).find(worker => worker.id === 'main')?.status === 'working'
    void $.ui.toast(
      busy
        ? 'Şef çalışırken sıkıştırılamaz; iş bitince yeniden dene.'
        : `Sıkıştırılamadı: ${error instanceof Error ? error.message : String(error)}`,
    )
  }
}

async function saveDeferred($: EngineInterface, value: string): Promise<void> {
  const names = [...new Set(value.split(/[\s,;]+/).map(name => name.trim()).filter(Boolean))]
  const refused = names.filter(name => NEVER_DEFERRED.has(name))
  const list = names.filter(name => !NEVER_DEFERRED.has(name))
  await update($, rounds, r => ({ ...r, defer: r.defer + 1 }))
  await $.store.set(STORE_DEFERRED, list)
  await update($, deferred, () => list)
  const not = refused.length > 0 ? ` (${refused.join(', ')} ertelenemez)` : ''
  void $.ui.toast(
    list.length > 0
      ? `Yeni sohbetlerde ertelenecek: ${list.join(', ')}${not}. Bu sohbet önbelleği bozulmasın diye değişmez.`
      : `Erteleme listesi boşaltıldı${not}; yeni sohbetlerde bütün araçlar önde.`,
  )
}

async function storedList($: EngineInterface): Promise<string[]> {
  const value = await $.store.get(STORE_DEFERRED).catch(() => undefined)

  return Array.isArray(value) ? value.filter((name): name is string => typeof name === 'string' && !NEVER_DEFERRED.has(name)) : []
}

function cacheGauge(stats: { lastResponseAt: number | null; last: Parameters<typeof hitPercent>[0] }, ttl: number | null, now: number): CacheGauge {
  const heat = warmth(stats.lastResponseAt, ttl, now)

  return { state: heat.state, text: warmthText(heat), hit: hitPercent(stats.last) }
}

const editedPath = (input: unknown): string | null => {
  const fields = input as { file_path?: unknown; notebook_path?: unknown }
  const path = fields.file_path ?? fields.notebook_path

  return typeof path === 'string' && path ? path : null
}

type TurnUsageLike = Parameters<typeof fromUsage>[0]

// A main-loop turn's tokens: the counters, the cache lifetime a long pause reveals,
// and the fixed load every request carries, estimated locally (no request is sent).
async function countTurn($: EngineInterface, agentId: string | undefined, used: TurnUsageLike | undefined): Promise<void> {
  if (agentId !== undefined || !used) return
  const turn = fromUsage(used)
  const now = await $.clock.now()
  const before = (await read($, tokens)).lastResponseAt
  if (before !== null && turnStartedAt > before) {
    const ttl = learnTtl(turnStartedAt - before, contextAtStart, turn)
    if (ttl !== null && ttl !== (await read($, cacheTtl))) {
      await update($, cacheTtl, () => ttl)
      await $.store.set(STORE_TTL, ttl)
    }
  }
  await update($, tokens, stats => withTurn(stats, turn, now))
  const measured = await $.session.usage({ breakdown: 'summary' })
  const breakdown = measured.context.breakdown
  if (breakdown) await update($, load, () => fixedLoad(breakdown, now))
  const percent = measured.context.percent ?? 0
  if (percent >= COMPACT_HINT_PERCENT && !compactHinted) {
    compactHinted = true
    void $.ui.toast(`Bağlam %${percent}: Piksel Ofis panelinden pano özetiyle sıkıştırabilirsin.`)
  }
}

// The refusal for an Agent call another chat's recent report already answers, once
// per report and brief; null lets the subagent start.
async function agentHeld($: EngineInterface, input: unknown): Promise<string | null> {
  if (!link) return null
  const fields = input as { description?: unknown; prompt?: unknown; subagent_type?: unknown }
  if (fields.subagent_type === 'fork') return null
  const description = typeof fields.description === 'string' ? fields.description : ''
  const prompt = typeof fields.prompt === 'string' ? fields.prompt : ''
  const now = await $.clock.now()
  const found = matchingFinding(`${description} ${prompt}`, link.project, await readFindings($, now), now)
  if (!found) return null
  const key = `${found.id}|${description}`
  if (heldAgents.has(key)) return null
  heldAgents.add(key)
  await note($, 'Pano', `alt ajan yerine ${found.label || 'başka sohbet'} raporu önerildi: ${clip(found.description, 30)}`)

  return findingText(found, now)
}

async function sendToChat($: EngineInterface, to: string, text: string): Promise<string> {
  const held = await read($, live)
  const wanted = to.trim().toLowerCase().replace(/^#?/, '#')
  const byName = to.trim().toLowerCase()
  const peer = held.peers.find(one => `#${one.slot + 1}` === wanted || titleOf(one).toLowerCase() === byName)
  if (!peer) {
    const known = held.peers.map(one => `#${one.slot + 1} "${titleOf(one)}"`).join(', ')

    return `Böyle bir sohbet şu an çalışmıyor: ${to}. Çalışanlar: ${known || 'yok'}.`
  }
  const sent = await $.session.send({ to: { sessionId: peer.sessionId }, text })
  if (!sent.isDelivered) return `#${peer.slot + 1} sohbetine iletilemedi: ${sent.reason}`
  await note($, 'Sen', `#${peer.slot + 1} sohbetine mesaj: ${clip(text, 40)}`)

  return `#${peer.slot + 1} "${titleOf(peer)}" sohbetine iletildi.`
}

export const register: Register = on => {
  on('session.start', async ($, e, next) => {
    await $.command.register({ name: 'ofis', description: 'Piksel Ofis panelini aç' })
    const now = await $.session.usage()
    await update($, usage, () => toUsage(now.context, now.rateLimits, now.cost))
    const storedDefer = await storedList($)
    await update($, deferred, () => storedDefer)
    const storedTtl = await $.store.get(STORE_TTL).catch(() => undefined)
    if (typeof storedTtl === 'number') await update($, cacheTtl, () => storedTtl)
    void $.ui.open({ id: PANE, title: TITLE })
    await $.tool
      .register({
        name: 'ofis_mesaj',
        description:
          'Aynı makinede çalışan başka bir Claude sohbetine kısa mesaj gönderir. `to`: Piksel Ofis panosundaki sohbet numarası (#1, #2…) ya da adı.',
        inputSchema: {
          type: 'object',
          properties: {
            to: { type: 'string', description: 'Sohbet numarası (#1) ya da panodaki adı' },
            text: { type: 'string', description: 'Mesaj; kısa ve kendi başına anlaşılır olsun' },
          },
          required: ['to', 'text'],
        },
        isDeferred: true,
      })
      .catch((error: unknown) => $.ui.log(`ofis_mesaj aracı kaydedilemedi: ${error instanceof Error ? error.message : String(error)}`))
    try {
      const home = (await $.env.get('USERPROFILE')) ?? (await $.env.get('HOME'))
      if (home) {
        const cwd = await $.session.cwd()
        const sessionId = await $.session.id()
        const dir = `${home}/.claude/pixel-ofis-live`
        const at = await $.clock.now()
        link = { dir, sessionId, project: baseName(cwd), startedAt: at, lastText: '', lastAt: 0, lastJournal: '', ticks: 0, failed: false }
        // A resumed chat finds its own entry again: its name and purpose stay.
        const before = await $.fs.read(journalPath(dir, sessionId)).catch(() => '')
        const past = typeof before === 'string' ? parseChronicle(before) : null
        if (past) {
          link.startedAt = past.startedAt
          const { name, purpose, tasks, files } = past
          await update($, board, info => (info.purpose ? info : { name, purpose, tasks, files }))
        }
        startLive($)
      }
    } catch (error) {
      $.ui.log(`Diğer sohbetler izlenemiyor: ${error instanceof Error ? error.message : String(error)}`)
    }

    return next(e)
  })

  on('session.end', async ($, e, next) => {
    const { slot } = await read($, live)
    if (link && link.sessionId === e.sessionId) {
      await writeJournal($, true).catch(() => undefined)
      if (slot !== null) await writeSlot($, slot, await $.clock.now(), true).catch(() => undefined)
      link.lastText = ''
      link.lastJournal = ''
    }
    if (e.reason === 'clear') {
      // The next conversation of this process is another chat: a board of its own.
      await update($, board, () => EMPTY_BOARD)
      await update($, live, held => ({ ...held, slot: null }))
      await update($, tokens, () => EMPTY_TOKENS)
      await update($, load, () => null)
      forgetNotes()
      heldWrites.clear()
      heldAgents.clear()
      briefs.clear()
      compactHinted = false
      if (link) link.startedAt = await $.clock.now()
    } else {
      timer?.cancel()
      timer = null
    }

    return next(e)
  })

  on('command.run', { command: 'ofis' }, async $ => {
    await $.ui.open({ id: PANE, title: TITLE, focus: true })

    return { text: 'Piksel Ofis açıldı.' }
  })

  on('session.measure', async ($, e, next) => {
    await update($, usage, () => toUsage(e.context, e.rateLimits, e.cost))

    return next(e)
  })

  on('turn.start', async ($, e, next) => {
    const at = await $.clock.now()
    if (e.agentId === undefined) {
      // A new request for the main session: the finished helpers go home.
      const task = clip(headline(e.text), 60)
      turnStartedAt = at
      contextAtStart = (await read($, usage))?.contextTokens ?? null
      await update($, workers, list =>
        list
          .filter(worker => worker.id === 'main' || worker.status === 'working')
          .map(
            (worker): Worker =>
              worker.id === 'main' ? { ...worker, status: 'working', station: 'board', tool: null, task, tools: 0, startedAt: at } : worker,
          ),
      )
      await note($, 'Şef', `yeni iş: ${clip(task, 50)}`)
      await changeBoard($, info => withTask(info, task))
    } else {
      const hire: Worker = { ...MAIN, id: e.agentId, name: 'Yardımcı', role: 'yardımcı', startedAt: at }
      await touch($, e.agentId, worker => ({ ...worker, status: 'working', station: 'board', tool: null }), hire)
    }

    return next(e)
  })

  on('agent.spawn', async ($, e, next) => {
    const started = await next(e)
    // A fork carries this chat's own context: its answer is no research for the others.
    if (started.agentId && !e.fork) briefs.set(started.agentId, { type: e.subagentType, description: e.description, prompt: e.prompt })
    if (started.agentId) await hireHelper($, e.subagentType, e.description, started.agentId).catch(
      (error: unknown) => $.ui.log(`Ofis güncellenemedi: ${error instanceof Error ? error.message : String(error)}`),
    )

    return started
  })

  on('tool.call', async ($, e, next) => {
    const id = e.agentId ?? 'main'
    const tool = String(e.tool)
    const at = await $.clock.now()
    const hire: Worker = { ...MAIN, id, name: 'Yardımcı', role: 'yardımcı', startedAt: at }
    // The drawing's bookkeeping must never hold up the tool itself.
    await touch($, id, worker => ({ ...worker, status: 'working', station: stationOf(tool), tool, tools: worker.tools + 1 }), hire).catch(
      (error: unknown) => $.ui.log(`Ofis güncellenemedi: ${error instanceof Error ? error.message : String(error)}`),
    )

    // Research another chat already had done: offered once before a subagent starts.
    if (tool === 'Agent') {
      const held = await agentHeld($, e).catch(() => null)
      if (held) return { deny: held }
    }

    // The board's guard: a file changed lately by another chat is not overwritten
    // blind, and every file this chat changes goes on its board entry.
    const path = EDIT_TOOLS.has(tool) ? editedPath(e) : null
    const now = at
    const held = path ? await read($, live) : null
    const conflicts = path && held ? conflictsFor(path, held.peers, await read($, history), now) : []
    const key = path ? pathKey(path) : ''
    // Held back once per file: the model is shown what changed and asked to Edit.
    if (path && tool === 'Write' && conflicts.length > 0 && !heldWrites.has(key)) {
      heldWrites.add(key)
      await note($, 'Pano', `üzerine yazma durduruldu: ${conflicts.map(one => one.label).join(', ')} bu dosyayı değiştirdi`)

      return { deny: heldWriteText(conflicts, await fileDiff($, path), now) }
    }
    const ran = await next(e)
    if (ran.deny !== undefined || ran.isError) return ran
    // How much of the context the result takes: the main loop's alone fills this chat's.
    if (e.agentId === undefined && typeof ran.text === 'string') {
      const output = { tool, label: callLabel(tool, e), chars: ran.text.length, at: now }
      await update($, tokens, stats => withOutput(stats, output)).catch(() => undefined)
    }
    if (!path) return ran
    await changeBoard($, info => ({ ...info, files: withFile(info.files, { path, at: now, tool }) })).catch((error: unknown) =>
      $.ui.log(`Pano güncellenemedi: ${error instanceof Error ? error.message : String(error)}`),
    )
    const extra: string[] = []
    // The board, when the model first changes a file after it changed: not with
    // every prompt, so a turn that only reads or talks is not charged for it.
    if (e.agentId === undefined) {
      const board = await freshNote($).catch(() => null)
      if (board) extra.push(board)
    }
    if (conflicts.length > 0 && now - (notedAt.get(key) ?? -Infinity) >= CONFLICT_NOTE_MS) {
      notedAt.set(key, now)
      extra.push(conflictText(conflicts, now))
    }

    return extra.length > 0 ? { ...ran, context: [...(ran.context ?? []), ...extra] } : ran
  })

  // A changed placement goes out in new threads only: the store is read for each, and
  // nothing invalidates a description a thread has already sent.
  on('tool.describe', async ($, e, next) => {
    const told = await next(e)
    const wanted = !NEVER_DEFERRED.has(e.tool) && (await storedList($)).includes(e.tool)
    const isDeferred = wanted || told.isDeferred === true || (told.isDeferred === undefined && e.isDeferred === true)
    const size: ToolSize = { tool: e.tool, tokens: approxTokens(told.description.length), isDeferred }
    await update($, toolSizes, list => [size, ...list.filter(one => one.tool !== e.tool)]).catch(() => undefined)

    return wanted ? { ...told, isDeferred: true } : told
  })

  // Every compaction of the main conversation, the engine's own included, is told
  // what the board knows, so its summary keeps the chat's purpose and files.
  on('session.compact', async ($, e, next) => {
    if (e.agentId !== undefined) return next(e)
    // The pane's own compaction carries them already.
    const told = e.instructions?.includes(COMPACT_MARK) ? null : compactInstructions(await read($, board), link?.project ?? '')
    const done = await next(told ? { ...e, instructions: [e.instructions, told].filter(Boolean).join('\n\n') } : e)
    if (e.trigger !== 'precompute' && !('skip' in done && typeof done.skip === 'string')) {
      forgetNotes()
      compactHinted = false
    }

    return done
  })

  on('tool.call', { tool: MESSAGE_TOOL }, async ($, e) => {
    const input = e as unknown as { to?: unknown; text?: unknown }
    const to = typeof input.to === 'string' ? input.to : ''
    const text = typeof input.text === 'string' ? input.text.trim() : ''
    if (!to || !text) return { result: '`to` ve `text` gerekli.' }

    return { result: await sendToChat($, to, text) }
  })

  on('turn.complete', async ($, e, next) => {
    const id = e.agentId ?? 'main'
    const failed = e.reason === 'error' || e.reason === 'refusal'
    await countTurn($, e.agentId, e.usage).catch((error: unknown) =>
      $.ui.log(`Token sayacı güncellenemedi: ${error instanceof Error ? error.message : String(error)}`),
    )
    if (e.agentId !== undefined && !failed && !e.isAborted && e.answer.trim().length >= MIN_FINDING_CHARS) {
      await saveFinding($, e.agentId, e.answer).catch((error: unknown) =>
        $.ui.log(`Keşif kaydedilemedi: ${error instanceof Error ? error.message : String(error)}`),
      )
    }
    let who = ''
    let tools = 0
    await touch($, id, worker => {
      who = worker.name
      tools = worker.tools
      const status = failed ? 'error' : id === 'main' ? 'idle' : 'done'

      return { ...worker, status, station: 'coffee', tool: null }
    })
    if (who) {
      const how = failed ? 'takıldı' : e.isAborted ? 'durduruldu' : 'bitirdi'
      await note($, who, `${how} (${tools} araç, ${Math.round(e.durationMs / 1000)} sn)`)
    }

    return next(e)
  })

  on('ui.render', { component: 'Pane', requestId: PANE }, async ($, e) => {
    const table = $.ui.resolve(e)
    const { Box, Text, Button } = table
    // The terminal has no Svg and the mobile app no Input: each falls back.
    // The surface decides, not `in`: a table answers for names it lacks too.
    const Svg = e.surface !== 'terminal' && 'Svg' in table ? table.Svg : undefined
    const Input = e.surface !== 'mobile' && 'Input' in table ? table.Input : undefined
    const team = await read($, workers)
    const meters = await read($, usage)
    const recent = await read($, log)
    const held = await read($, live)
    const files = await read($, attachments)
    const round = await read($, rounds)
    const fillable = await read($, canFill)
    const info = await read($, board)
    const past = await read($, history)
    const spent = await read($, tokens)
    const fixed = await read($, load)
    const reports = await read($, findings)
    const later = await read($, deferred)
    const sizes = await read($, toolSizes)
    const ttl = await read($, cacheTtl)
    const now = await $.clock.now()
    const teams = teamsOf(team, info, held)
    const gauge = cacheGauge(spent, ttl, now)
    const last = spent.last
    const heavy = spent.heavy.map(one => `${one.tool}${one.label ? ` ${one.label}` : ''} ≈${kilo(approxTokens(one.chars))}`)
    const byTool = Object.entries(spent.byTool)
      .sort((a, b) => b[1] - a[1])
      .slice(0, 4)
      .map(([tool, chars]) => `${tool} ≈${kilo(approxTokens(chars))}`)
    const front = sizes
      .filter(one => !one.isDeferred)
      .sort((a, b) => b.tokens - a.tokens)
      .slice(0, 6)
      .map(one => `${one.tool} ≈${kilo(one.tokens)}`)
    const percent = meters?.contextPercent ?? 0

    const rename = (value: string): void => {
      const name = value.trim().slice(0, 60)
      void update($, rounds, r => ({ ...r, name: r.name + 1 }))
      void changeBoard($, held => ({ ...held, name })).then(() =>
        $.ui.toast(name ? `Bu sohbetin adı: ${name}` : 'Ad kaldırıldı; panoda amacı görünür.'),
      )
    }
    const removeFile = (path: string): void => {
      void update($, attachments, list => list.filter(file => file.path !== path))
    }
    const addScreenshot = (): void => {
      void latestScreenshot($).then(path =>
        path ? addFiles($, [path]) : $.ui.toast('Ekran görüntüleri klasöründe görüntü bulunamadı.'),
      )
    }
    const addPaths = (value: string): void => {
      const paths = parsePaths(value)
      void update($, rounds, r => ({ ...r, attach: r.attach + 1 }))
      if (paths.length > 0) void addFiles($, paths)
    }

    return (
      <Box flexDirection="column" gap={1}>
        {Svg ? (
          <Svg source={officeSvg(teams, meters, now, gauge)} alt={officeAlt(teams, meters, gauge)} />
        ) : (
          <Text dimColor>{officeAlt(teams, meters, gauge)}</Text>
        )}
        <Box flexDirection="column">
          <Text weight="semibold">
            Pano · {teams.length === 1 ? 'yalnız bu sohbet çalışıyor' : `${teams.length} sohbet çalışıyor`}
          </Text>
          {teams.map((one, i) => {
            const peer = one.isSelf ? null : held.peers[i - 1]
            const detail = peer ? detailLine(peer.task, peer, peer.project) : detailLine(one.task, info, link?.project ?? '')

            return (
              <Box flexDirection="column">
                <Text color={one.isSelf ? undefined : one.color} wrap="truncate-end">
                  {teamLine(one)}
                </Text>
                {detail && (
                  <Text dimColor wrap="truncate-end">
                    {'   '}
                    {detail}
                  </Text>
                )}
              </Box>
            )
          })}
          {past.length > 0 && <Text dimColor>Kapanan / sessiz sohbetler (son 24 saat):</Text>}
          {past.map(one => (
            <Text dimColor wrap="truncate-end">
              {one.label || '—'} · {ago(one.updatedAt, now)} · {titleOf(one)}
              {one.files.length > 0 ? ` · dosyalar: ${filesLine(one.files, one.project, 4)}` : ''}
            </Text>
          ))}
          {Input && (
            <Input
              key={`ad-${round.name}`}
              placeholder={`Bu sohbete ad ver (şimdi: ${titleOf(info)})`}
              submitLabel="Kaydet"
              onSubmit={rename}
            />
          )}
          {reports.length > 0 && <Text dimColor>Diğer sohbetlerin keşifleri (alt ajan yeniden başlatılmadan önce önerilir):</Text>}
          {reports.slice(0, 4).map(one => (
            <Text dimColor wrap="truncate-end">
              {one.label || '—'} · {one.type} · {ago(one.at, now)} · {one.description}
            </Text>
          ))}
        </Box>
        <Box flexDirection="column">
          <Text weight="semibold">Token</Text>
          <Text dimColor wrap="truncate-end">
            {last
              ? `Son tur: girdi ${kilo(last.input)} · önbellekten ${kilo(last.cacheRead)} · önbelleğe yazılan ${kilo(last.cacheWrite)} · çıktı ${kilo(last.output)}`
              : 'Son tur: ilk yanıttan sonra görünür'}
          </Text>
          <Text dimColor wrap="truncate-end">
            Önbellek: {gauge.text}
            {gauge.hit === null ? '' : ` · isabet %${gauge.hit}`}
            {spent.turns > 0 ? ` · oturum: ${spent.turns} tur, çıktı ${kilo(spent.total.output)}` : ''}
          </Text>
          {heavy.length > 0 && (
            <Text dimColor wrap="truncate-end">
              En ağır araç çıktıları: {heavy.join(' · ')}
            </Text>
          )}
          {byTool.length > 0 && (
            <Text dimColor wrap="truncate-end">
              Araca göre çıktı: {byTool.join(' · ')}
            </Text>
          )}
          {fixed && fixed.rows.length > 0 && (
            <Text dimColor wrap="truncate-end">
              Sabit yük (her istekte): {fixed.rows.slice(0, 5).map(row => `${row.name} ${kilo(row.tokens)}`).join(' · ')}
            </Text>
          )}
          {fixed && fixed.memory.length > 0 && (
            <Text dimColor wrap="truncate-end">
              En büyük bellek dosyaları: {fixed.memory.map(row => `${row.name} ${kilo(row.tokens)}`).join(' · ')}
            </Text>
          )}
          {percent >= COMPACT_OFFER_PERCENT && (
            <Box flexDirection="row" flexWrap="wrap" gap={1}>
              <Button key="sikistir" onPress={() => void compactNow($)}>
                Pano özetiyle sıkıştır (bağlam %{percent})
              </Button>
            </Box>
          )}
          {front.length > 0 && (
            <Text dimColor wrap="truncate-end">
              Öndeki en büyük araç açıklamaları: {front.join(' · ')}
            </Text>
          )}
          <Text dimColor wrap="truncate-end">
            Ertelenen araçlar (yeni sohbetlerde ToolSearch arkasında): {later.length > 0 ? later.join(', ') : 'yok'}
          </Text>
          {Input && (
            <Input
              key={`ertele-${round.defer}`}
              placeholder="Ertelenecek araç adları, virgülle (boş Enter: listeyi boşalt)"
              submitLabel="Kaydet"
              onSubmit={value => {
                void saveDeferred($, value)
              }}
            />
          )}
        </Box>
        {Input && (
          <Box flexDirection="column" gap={1}>
            <Input
              key={`gorev-${round.task}`}
              placeholder="Ekibe görev ver… (Enter: gönder)"
              submitLabel="Gönder"
              rows={2}
              onInput={value => {
                draft = value
              }}
              onSubmit={value => {
                void sendTask($, value)
              }}
            />
            {files.length > 0 && (
              <Box flexDirection="row" flexWrap="wrap" gap={1}>
                <Text dimColor>Ekler:</Text>
                {files.map(file => (
                  <Button key={`ek-${file.path}`} dimColor onPress={() => removeFile(file.path)}>
                    {file.name} ✕
                  </Button>
                ))}
              </Box>
            )}
            <Box flexDirection="row" flexWrap="wrap" gap={1}>
              <Button key="ek-ekran" onPress={addScreenshot}>
                + Son ekran görüntüsü
              </Button>
              {fillable && (
                <Button key="kutuya-aktar" onPress={() => void toComposer($)}>
                  Sohbet kutusuna aktar
                </Button>
              )}
            </Box>
            <Input
              key={`ek-yolu-${round.attach}`}
              placeholder="Ek dosya: yolu yapıştır, Enter (birden çok: tırnaklı ya da satır satır)"
              submitLabel="Ekle"
              onSubmit={addPaths}
            />
            <Text dimColor wrap="wrap">
              Panelden verilen görev sohbet akışında mesaj balonu olarak görünmeyebilir; yanıt sohbete gelir, durumu burada izle.
            </Text>
          </Box>
        )}
        <Box flexDirection="column">
          {recent.length === 0 && <Text dimColor>Henüz hareket yok.</Text>}
          {recent
            .slice()
            .reverse()
            .map(entry => (
              <Text dimColor wrap="truncate-end">
                {entry.who}: {entry.text}
              </Text>
            ))}
        </Box>
      </Box>
    )
  })
}
