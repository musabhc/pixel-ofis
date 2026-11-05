import type { BoardInfo, Chronicle, FileChange, Peer, WorkerStatus } from '../types'

// The board: who each chat is, what it is for and which files it changed. Pure
// helpers; the hooks module reads and writes the folders.

export const MAX_FILES = 20
export const MAX_TASKS = 5
// A change this recent by another chat is a reason to look before writing.
export const CONFLICT_WINDOW_MS = 2 * 60 * 60 * 1000
// Files named per chat in the model's note: enough to steer, few enough to stay cheap.
const NOTE_FILES = 8

export const EMPTY_BOARD: BoardInfo = { name: '', purpose: '', tasks: [], files: [] }

// Windows paths compare without case and either slash.
export const pathKey = (path: string): string => path.replace(/\\/g, '/').toLowerCase()

// A path as the project sees it (`src/ui/x.py`), else its last two parts.
export function shortPath(path: string, project: string): string {
  const parts = path.replace(/\\/g, '/').split('/').filter(Boolean)
  const at = project ? parts.findLastIndex(part => part.toLowerCase() === project.toLowerCase()) : -1

  return at >= 0 && at < parts.length - 1 ? parts.slice(at + 1).join('/') : parts.slice(-2).join('/')
}

export function withFile(files: FileChange[], change: FileChange): FileChange[] {
  const key = pathKey(change.path)

  return [change, ...files.filter(file => pathKey(file.path) !== key)].slice(0, MAX_FILES)
}

export function withTask(info: BoardInfo, task: string): BoardInfo {
  if (!task) return info

  return {
    ...info,
    purpose: info.purpose || task,
    tasks: [task, ...info.tasks.filter(one => one !== task)].slice(0, MAX_TASKS),
  }
}

export const titleOf = (info: BoardInfo): string => info.name || info.purpose || 'adsız sohbet'

export function filesLine(files: FileChange[], project: string, max: number): string {
  if (files.length === 0) return ''
  const shown = files.slice(0, max).map(file => shortPath(file.path, project))
  const more = files.length > max ? ` +${files.length - max}` : ''

  return `${shown.join(', ')}${more}`
}

export function ago(at: number, now: number): string {
  const minutes = Math.max(0, Math.round((now - at) / 60000))
  if (minutes < 1) return 'az önce'
  if (minutes < 60) return `${minutes} dk önce`

  return `${Math.floor(minutes / 60)} sa önce`
}

export type Conflict = { label: string; title: string; sessionId: string; at: number }

// The other chats that changed `path` lately: live ones and those that ended.
export function conflictsFor(path: string, peers: Peer[], history: Chronicle[], now: number): Conflict[] {
  const key = pathKey(path)
  const found: Conflict[] = []
  const look = (label: string, info: BoardInfo, sessionId: string): void => {
    const change = info.files.find(file => pathKey(file.path) === key)
    if (change && now - change.at < CONFLICT_WINDOW_MS) found.push({ label, title: titleOf(info), sessionId, at: change.at })
  }
  for (const peer of peers) look(`#${peer.slot + 1}`, peer, peer.sessionId)
  for (const past of history) look(past.label || 'eski sohbet', past, past.sessionId)

  return found
}

export function conflictText(conflicts: Conflict[], now: number): string {
  const who = conflicts.map(one => `${one.label} "${one.title}" (${ago(one.at, now)})`).join(', ')

  return `Piksel Ofis: bu dosyayı başka sohbet de değiştirdi: ${who}. Onun değişikliğini geri almadığından emin ol; gerekirse mcp__pixel-ofis__ofis_mesaj ile o sohbete yaz.`
}

const STATUS_WORDS: Record<WorkerStatus, string> = { working: 'çalışıyor', idle: 'boşta', done: 'bitti', error: 'takıldı' }

export function statusWord(status: WorkerStatus | undefined): string {
  return status ? STATUS_WORDS[status] : 'boşta'
}

// The note the model reads beside a prompt while other chats share the repository:
// who they are and what they touched, so nobody has to ask, list or re-read to know.
export function boardNote(selfLabel: string, self: BoardInfo, peers: Peer[], history: Chronicle[], now: number): string | null {
  const lines: string[] = []
  for (const peer of peers) {
    const chief = peer.workers.find(worker => worker.id === 'main')
    const doing = peer.task && peer.task !== peer.purpose ? ` — şu an: ${peer.task}` : ''
    const files = filesLine(peer.files, peer.project, NOTE_FILES)
    lines.push(`- #${peer.slot + 1} "${titleOf(peer)}" (${statusWord(chief?.status)})${doing}${files ? `. Değiştirdiği dosyalar: ${files}` : ''}`)
  }
  for (const past of history) {
    if (past.files.length === 0 || now - past.updatedAt > CONFLICT_WINDOW_MS) continue
    lines.push(`- ${past.label || 'eski sohbet'} "${titleOf(past)}" (kapandı). Değiştirdiği dosyalar: ${filesLine(past.files, past.project, NOTE_FILES)}`)
  }
  if (lines.length === 0) return null

  return [
    '[Piksel Ofis panosu: aynı makinede çalışan diğer sohbetler]',
    `Bu sohbet: ${selfLabel || '#?'} "${titleOf(self)}".`,
    ...lines,
    'Bu dosyalara dokunmadan önce güncel hâlini oku ve onların değişikliğini geri alma. Bir sohbete yazman gerekirse mcp__pixel-ofis__ofis_mesaj aracını kullan (önce ToolSearch "select:mcp__pixel-ofis__ofis_mesaj").',
  ].join('\n')
}

export function parseChronicle(text: string): Chronicle | null {
  try {
    const value = JSON.parse(text) as Partial<Chronicle>
    if (typeof value.sessionId !== 'string' || typeof value.updatedAt !== 'number') return null

    return { label: '', project: '', startedAt: value.updatedAt, ...EMPTY_BOARD, ...value } as Chronicle
  } catch {
    return null
  }
}
