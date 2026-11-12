import { atom, read, update } from 'claude-code'
import type { EngineInterface, Register, SessionContextUsage, SessionCost, SessionRateLimit, Timer } from 'claude-code'

import type { BoardInfo, Chronicle, Finding, LimitReading, Live, Peer, Station, Team, Usage, Worker } from '../types'
import {
  boardNote,
  clipDiff,
  COMPACT_MARK,
  compactInstructions,
  conflictsFor,
  conflictText,
  EMPTY_BOARD,
  FINDING_SUMMARY,
  FINDING_WINDOW_MS,
  findingText,
  heldWriteText,
  matchingFinding,
  parseChronicle,
  parseFindings,
  pathKey,
  titleOf,
  transcriptTitle,
  withFile,
  withTask,
} from './board'
import { currentLimits, limitsText, mergeLimits, parseLimits } from './limits'
import { LEAVE_AFTER_MS, officeAlt, officeSvg } from './scene'
import type { CacheGauge } from './scene'
import { EMPTY_TOKENS, fromUsage, hitPercent, learnTtl, warmth, warmthText, withTurn } from './tokens'

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
const usage = atom({ plugin: 'pixel-ofis', key: 'usage' } as const, null, { shape: 'usage-1' })
// The account's rate-limit windows at the latest reading any chat on this machine took.
const sharedLimits = atom({ plugin: 'pixel-ofis', key: 'sharedLimits' } as const, [], { shape: 'shared-limits-1' })
const live = atom({ plugin: 'pixel-ofis', key: 'live' } as const, { slot: null, peers: [] }, { shape: 'live-3' })
const board = atom({ plugin: 'pixel-ofis', key: 'board' } as const, EMPTY_BOARD, { shape: 'board-1' })
const history = atom({ plugin: 'pixel-ofis', key: 'history' } as const, [], { shape: 'history-1' })
const tokens = atom({ plugin: 'pixel-ofis', key: 'tokens' } as const, EMPTY_TOKENS, { shape: 'tokens-2' })
const cacheTtl = atom({ plugin: 'pixel-ofis', key: 'cacheTtl' } as const, null, { shape: 'cache-ttl-1' })
// When this chat's main loop last started or finished a turn: how long it has waited.
const activeAt = atom({ plugin: 'pixel-ofis', key: 'activeAt' } as const, 0, { shape: 'active-at-1' })
// A newer version of the mod on disk than this chat runs: what the pane warns of.
const newer = atom({ plugin: 'pixel-ofis', key: 'newer' } as const, null, { shape: 'newer-1' })

// Kept across sessions in the plugin's store.
const STORE_TTL = 'cacheTtlMs'
// The pane offers a compaction from this share of the context window on.
const COMPACT_OFFER_PERCENT = 60
// And says so once, in a toast, from this share on.
const COMPACT_HINT_PERCENT = 70
// A subagent's answer shorter than this is no report worth keeping.
const MIN_FINDING_CHARS = 200
const FINDINGS_KEPT = 10
const FINDINGS_SHOWN = 12

// Every chat writes its team to a slot file of one folder and reads the others':
// a fixed pool, so nothing has to be deleted when a chat goes away.
const SLOT_COUNT = 12
const TICK_MS = 3000
const HEARTBEAT_MS = 10000
const STALE_MS = 45000
// The journal folder is read every tenth tick: ended chats change seldom.
const HISTORY_EVERY = 10
// The other chats' limit readings every fifth tick: a whole point takes minutes to spend.
const LIMITS_EVERY = 5
const REDRAW_EVERY = 20
const HISTORY_SPAN_MS = 24 * 60 * 60 * 1000
const HISTORY_SHOWN = 6
// A conflict note after an Edit is repeated for one path at most this often.
const CONFLICT_NOTE_MS = 10 * 60 * 1000

const EDIT_TOOLS = new Set(['Edit', 'Write', 'MultiEdit', 'NotebookEdit'])
const MESSAGE_TOOL = 'mcp__pixel-ofis__ofis_mesaj'

const TEAM_COLORS = ['#4fd1ff', '#ff7ab6', '#9dff6a', '#ffb347', '#c39bff', '#ff6b6b']
const SELF_COLOR = '#ffd700'

type Snapshot = BoardInfo & {
  sessionId: string
  project: string
  task: string
  workers: Worker[]
  activeAt?: number
  updatedAt: number
  ended?: true
}

type Link = {
  dir: string
  configDir: string
  cwd: string
  sessionId: string
  project: string
  startedAt: number
  lastText: string
  lastAt: number
  lastJournal: string
  ticks: number
  failed: boolean
  // The session's transcript, once found; whether the projects folder was searched.
  transcript: string | null
  searched: boolean
}

// Module values start over on a reload, when `session.start` sets them again.
let link: Link | null = null
// The version this chat loaded, from the manifest as it stood at the load.
let loadedVersion: string | null = null
let timer: Timer | null = null
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

const errorText = (error: unknown): string => (error instanceof Error ? error.message : String(error))

function toUsage(context: SessionContextUsage, rateLimits: SessionRateLimit[], cost: SessionCost | undefined): Usage {
  return {
    contextPercent: context.percent ?? null,
    contextTokens: context.tokens ?? null,
    contextWindow: context.window,
    limits: rateLimits.map(limit => ({ kind: limit.kind, percentUsed: limit.percentUsed, resetsAt: limit.resetsAt ?? null })),
    usd: cost?.usd ?? null,
  }
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

const limitsPath = (dir: string): string => `${dir}/limits.json`

// Joins the rate-limit readings this chat knows (its own and those it already took from
// the other chats) with the shared file's, and shows the latest of all. Every write
// merges, so a later reading a racing write lost is written back on the next tick.
// `mine`: a reading this chat's response just reported.
async function shareLimits($: EngineInterface, mine: LimitReading[] = []): Promise<void> {
  let latest = mergeLimits(await read($, sharedLimits), mine)
  if (link) {
    const path = limitsPath(link.dir)
    const text = await $.fs.read(path).catch(() => '')
    const stored = typeof text === 'string' ? parseLimits(text) : []
    latest = mergeLimits(stored, latest)
    if (limitsText(latest) !== limitsText(stored)) await $.fs.write(path, limitsText(latest))
  }
  if (limitsText(latest) !== limitsText(await read($, sharedLimits))) await update($, sharedLimits, () => latest)
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
  await writeJournal($).catch((error: unknown) => $.ui.log(`Pano günlüğü yazılamadı: ${errorText(error)}`))
}

// Ended or silent chats of the last day, newest first: what the board guards remember.
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
    activeAt: await read($, activeAt),
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
    link.transcript = null
    link.searched = false
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
  // What the other chats' responses said of the account's limits meanwhile.
  if (link.ticks % LIMITS_EVERY === 0) await shareLimits($)

  const peers: Peer[] = []
  snaps.forEach((snap, index) => {
    if (index === slot || !isFresh(snap, now) || snap.sessionId === link?.sessionId) return
    const { sessionId, project, task, workers: crew, name, purpose, tasks, files } = snap
    const peer: Peer = { sessionId, slot: index, project, task, workers: crew, name, purpose, tasks, files }
    peers.push(typeof snap.activeAt === 'number' ? { ...peer, activeAt: snap.activeAt } : peer)
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
    await checkVersion($)
    const liveIds = new Set([link.sessionId, ...peers.map(peer => peer.sessionId)])
    const past = await readHistory($, now, liveIds)
    if (JSON.stringify(past) !== JSON.stringify(await read($, history))) await update($, history, () => past)
  }
  // Waiting minutes, the cache's clock and the limits' countdowns move with time alone.
  if (link.ticks % REDRAW_EVERY === 0) $.ui.invalidate('ui.render')
  link.ticks += 1
}

function startLive($: EngineInterface): void {
  timer?.cancel()
  const run = (): void => {
    void tick($).catch((error: unknown) => {
      if (link && !link.failed) {
        link.failed = true
        $.ui.log(`Diğer sohbetler okunamadı: ${errorText(error)}`)
      }
    })
  }
  timer = $.clock.every(TICK_MS, run)
  run()
}

// ---- A newer version on disk ---------------------------------------------------------

async function manifestVersion($: EngineInterface): Promise<string | null> {
  const text = await $.fs.read(`${$.plugin.root}/.claude-plugin/plugin.json`).catch(() => null)
  if (typeof text !== 'string') return null
  try {
    const version = (JSON.parse(text) as { version?: unknown }).version

    return typeof version === 'string' ? version : null
  } catch {
    return null
  }
}

// A chat whose folder is not watched keeps the code it loaded: the pane says when the
// disk holds another version, and what takes it in.
async function checkVersion($: EngineInterface): Promise<void> {
  if (!loadedVersion) return
  const disk = await manifestVersion($)
  const next = disk && disk !== loadedVersion ? { loaded: loadedVersion, disk } : null
  if (JSON.stringify(next) !== JSON.stringify(await read($, newer))) await update($, newer, () => next)
}

// ---- The chat's title: the one Claude Code shows for the session --------------------

// Claude Code names a project's folder after its path, every other character a dash.
const projectFolder = (cwd: string): string => cwd.replace(/[^a-zA-Z0-9]/g, '-')

async function findTranscript($: EngineInterface): Promise<string | null> {
  if (!link) return null
  if (link.transcript) return link.transcript
  const projects = `${link.configDir}/projects`
  const name = `${link.sessionId}.jsonl`
  const guess = `${projects}/${projectFolder(link.cwd)}/${name}`
  if (await $.fs.exists(guess).catch(() => false)) {
    link.transcript = guess

    return guess
  }
  // A folder named otherwise: looked for once per conversation.
  if (link.searched) return null
  link.searched = true
  for (const entry of await $.fs.list(projects).catch(() => [])) {
    if (entry.kind !== 'dir') continue
    const path = `${projects}/${entry.name}/${name}`
    if (await $.fs.exists(path).catch(() => false)) {
      link.transcript = path

      return path
    }
  }

  return null
}

// The board carries the session's title as the chat's name; a transcript too large to
// read keeps the title it had.
async function refreshTitle($: EngineInterface): Promise<void> {
  const path = await findTranscript($)
  if (!path) return
  const text = await $.fs.read(path).catch(() => null)
  if (typeof text !== 'string') return
  const title = clip(transcriptTitle(text), 80)
  if (title && title !== (await read($, board)).name) await changeBoard($, info => ({ ...info, name: title }))
}

// ---- The drawing ---------------------------------------------------------------------

// How long a chat with nobody at work has waited: null while anyone in it works,
// Infinity for a chat that never said when it was last active.
function waitedMs(crew: Worker[], since: number | undefined, now: number): number | null {
  if (crew.some(worker => worker.status === 'working')) return null
  const last = since ?? Math.max(0, ...crew.map(worker => worker.startedAt))

  return last > 0 ? Math.max(0, now - last) : Number.POSITIVE_INFINITY
}

// This chat and the others still in the office: a chat that waited past the limit
// has left, though its window may still be open. This chat never leaves its own pane.
function teamsOf(own: Worker[], info: BoardInfo, held: Live, since: number, now: number): Team[] {
  const self: Team = {
    label: held.slot === null ? '' : `#${held.slot + 1}`,
    color: SELF_COLOR,
    isSelf: true,
    title: info.name || info.purpose,
    task: own.find(worker => worker.id === 'main')?.task ?? '',
    files: info.files.length,
    workers: own,
    waitingMs: waitedMs(own, since || now, now),
  }
  const others: Team[] = []
  for (const peer of held.peers) {
    const waiting = waitedMs(peer.workers, peer.activeAt, now)
    if (waiting !== null && waiting >= LEAVE_AFTER_MS) continue
    others.push({
      label: `#${peer.slot + 1}`,
      color: TEAM_COLORS[others.length % TEAM_COLORS.length] ?? SELF_COLOR,
      isSelf: false,
      title: peer.name || peer.purpose,
      task: peer.task,
      files: peer.files.length,
      workers: peer.workers,
      waitingMs: waiting,
    })
  }

  return [self, ...others]
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
    void $.ui.toast('Sohbet pano özetiyle sıkıştırıldı.')
  } catch (error) {
    const busy = (await read($, workers)).find(worker => worker.id === 'main')?.status === 'working'
    void $.ui.toast(busy ? 'Şef çalışırken sıkıştırılamaz; iş bitince yeniden dene.' : `Sıkıştırılamadı: ${errorText(error)}`)
  }
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

// A main-loop turn's tokens: the cache's clock, and the lifetime a long pause reveals.
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
  const percent = (await $.session.usage()).context.percent ?? 0
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

  return `#${peer.slot + 1} "${titleOf(peer)}" sohbetine iletildi.`
}

export const register: Register = on => {
  on('session.start', async ($, e, next) => {
    await $.command.register({ name: 'ofis', description: 'Piksel Ofis panelini aç' })
    const now = await $.session.usage()
    const started = toUsage(now.context, now.rateLimits, now.cost)
    await update($, usage, () => started)
    // Shared with the other chats on the first tick, once the live folder is known.
    await update($, sharedLimits, known => mergeLimits(known, started.limits))
    loadedVersion = await manifestVersion($)
    await update($, newer, () => null)
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
      .catch((error: unknown) => $.ui.log(`ofis_mesaj aracı kaydedilemedi: ${errorText(error)}`))
    try {
      const home = (await $.env.get('USERPROFILE')) ?? (await $.env.get('HOME'))
      if (home) {
        const cwd = await $.session.cwd()
        const sessionId = await $.session.id()
        const dir = `${home}/.claude/pixel-ofis-live`
        const configDir = (await $.env.get('CLAUDE_CONFIG_DIR')) || `${home}/.claude`
        const at = await $.clock.now()
        // A reload keeps the time this chat was last active; a new chat starts waiting now.
        if ((await read($, activeAt)) === 0) await update($, activeAt, () => at)
        link = {
          dir,
          configDir,
          cwd,
          sessionId,
          project: baseName(cwd),
          startedAt: at,
          lastText: '',
          lastAt: 0,
          lastJournal: '',
          ticks: 0,
          failed: false,
          transcript: null,
          searched: false,
        }
        // A resumed chat finds its own entry again: its name and purpose stay.
        const before = await $.fs.read(journalPath(dir, sessionId)).catch(() => '')
        const past = typeof before === 'string' ? parseChronicle(before) : null
        if (past) {
          link.startedAt = past.startedAt
          const { name, purpose, tasks, files } = past
          await update($, board, info => (info.purpose ? info : { name, purpose, tasks, files }))
        }
        startLive($)
        await refreshTitle($).catch((error: unknown) => $.ui.log(`Sohbet başlığı okunamadı: ${errorText(error)}`))
      }
    } catch (error) {
      $.ui.log(`Diğer sohbetler izlenemiyor: ${errorText(error)}`)
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
      const at = await $.clock.now()
      await update($, board, () => EMPTY_BOARD)
      await update($, live, held => ({ ...held, slot: null }))
      await update($, tokens, () => EMPTY_TOKENS)
      await update($, activeAt, () => at)
      forgetNotes()
      heldWrites.clear()
      heldAgents.clear()
      briefs.clear()
      compactHinted = false
      if (link) link.startedAt = at
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
    const measured = toUsage(e.context, e.rateLimits, e.cost)
    await update($, usage, () => measured)
    await shareLimits($, measured.limits).catch((error: unknown) => $.ui.log(`Limitler paylaşılamadı: ${errorText(error)}`))

    return next(e)
  })

  on('turn.start', async ($, e, next) => {
    const at = await $.clock.now()
    if (e.agentId === undefined) {
      // A new request for the main session: the finished helpers go home.
      const task = clip(headline(e.text), 60)
      turnStartedAt = at
      contextAtStart = (await read($, usage))?.contextTokens ?? null
      await update($, activeAt, () => at)
      await update($, workers, list =>
        list
          .filter(worker => worker.id === 'main' || worker.status === 'working')
          .map(
            (worker): Worker =>
              worker.id === 'main' ? { ...worker, status: 'working', station: 'board', tool: null, task, tools: 0, startedAt: at } : worker,
          ),
      )
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
    if (started.agentId) {
      await hireHelper($, e.subagentType, e.description, started.agentId).catch((error: unknown) =>
        $.ui.log(`Ofis güncellenemedi: ${errorText(error)}`),
      )
    }

    return started
  })

  on('tool.call', async ($, e, next) => {
    const id = e.agentId ?? 'main'
    const tool = String(e.tool)
    const at = await $.clock.now()
    const hire: Worker = { ...MAIN, id, name: 'Yardımcı', role: 'yardımcı', startedAt: at }
    // The drawing's bookkeeping must never hold up the tool itself.
    await touch($, id, worker => ({ ...worker, status: 'working', station: stationOf(tool), tool, tools: worker.tools + 1 }), hire).catch(
      (error: unknown) => $.ui.log(`Ofis güncellenemedi: ${errorText(error)}`),
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

      return { deny: heldWriteText(conflicts, await fileDiff($, path), now) }
    }
    const ran = await next(e)
    if (ran.deny !== undefined || ran.isError || !path) return ran
    await changeBoard($, info => ({ ...info, files: withFile(info.files, { path, at: now, tool }) })).catch((error: unknown) =>
      $.ui.log(`Pano güncellenemedi: ${errorText(error)}`),
    )
    const extra: string[] = []
    // The board, when the model first changes a file after it changed: not with
    // every prompt, so a turn that only reads or talks is not charged for it.
    if (e.agentId === undefined) {
      const note = await freshNote($).catch(() => null)
      if (note) extra.push(note)
    }
    if (conflicts.length > 0 && now - (notedAt.get(key) ?? -Infinity) >= CONFLICT_NOTE_MS) {
      notedAt.set(key, now)
      extra.push(conflictText(conflicts, now))
    }

    return extra.length > 0 ? { ...ran, context: [...(ran.context ?? []), ...extra] } : ran
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
    await countTurn($, e.agentId, e.usage).catch((error: unknown) => $.ui.log(`Token sayacı güncellenemedi: ${errorText(error)}`))
    if (e.agentId !== undefined && !failed && !e.isAborted && e.answer.trim().length >= MIN_FINDING_CHARS) {
      await saveFinding($, e.agentId, e.answer).catch((error: unknown) => $.ui.log(`Keşif kaydedilemedi: ${errorText(error)}`))
    }
    await touch($, id, worker => ({ ...worker, status: failed ? 'error' : id === 'main' ? 'idle' : 'done', station: 'coffee', tool: null }))
    if (e.agentId === undefined) {
      // The chat starts waiting for its next task; by now the session has its title.
      const at = await $.clock.now()
      await update($, activeAt, () => at)
      await refreshTitle($).catch((error: unknown) => $.ui.log(`Sohbet başlığı okunamadı: ${errorText(error)}`))
    }

    return next(e)
  })

  on('ui.render', { component: 'Pane', requestId: PANE }, async ($, e) => {
    const table = $.ui.resolve(e)
    const { Box, Text, Button } = table
    // The terminal has no Svg: it gets the office as text.
    // The surface decides, not `in`: a table answers for names it lacks too.
    const Svg = e.surface !== 'terminal' && 'Svg' in table ? table.Svg : undefined
    const now = await $.clock.now()
    const own = await read($, usage)
    // The limits are the account's: the latest any chat read, not only this one.
    const limits = currentLimits(mergeLimits(own?.limits ?? [], await read($, sharedLimits)), now)
    const meters = own ? { ...own, limits } : null
    const teams = teamsOf(await read($, workers), await read($, board), await read($, live), await read($, activeAt), now)
    const gauge = cacheGauge(await read($, tokens), await read($, cacheTtl), now)
    const percent = meters?.contextPercent ?? 0
    const fresh = await read($, newer)

    return (
      <Box flexDirection="column" gap={1}>
        {Svg ? (
          <Svg source={officeSvg(teams, meters, now, gauge)} alt={officeAlt(teams, meters, gauge)} />
        ) : (
          <Text dimColor>{officeAlt(teams, meters, gauge)}</Text>
        )}
        {fresh && (
          <Text dimColor wrap="wrap">
            Piksel Ofis {fresh.disk} hazır, bu sohbet hâlâ {fresh.loaded} sürümünde. Almak için sohbet sekmesini kapatıp geçmişten
            yeniden aç: yeniden açmak kendi başına istek göndermez, sohbet kaldığı yerden sürer.
          </Text>
        )}
        {percent >= COMPACT_OFFER_PERCENT && (
          <Box flexDirection="row" flexWrap="wrap" gap={1}>
            <Button key="sikistir" onPress={() => void compactNow($)}>
              Pano özetiyle sıkıştır (bağlam %{percent})
            </Button>
          </Box>
        )}
      </Box>
    )
  })
}
