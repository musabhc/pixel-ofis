import type { BoardInfo, Chronicle, FileChange, Finding, Peer, WorkerStatus } from '../types'

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

// The note the model reads when it first changes a file while other chats share the
// machine: who they are and what they touched, so nobody has to ask, list or re-read
// to know. `withHowTo` adds how to reach them, said once per conversation.
export function boardNote(
  selfLabel: string,
  self: BoardInfo,
  peers: Peer[],
  history: Chronicle[],
  now: number,
  withHowTo = true,
): string | null {
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
    withHowTo
      ? 'Bu dosyalara dokunmadan önce güncel hâlini oku ve onların değişikliğini geri alma. Bir sohbete yazman gerekirse mcp__pixel-ofis__ofis_mesaj aracını kullan (önce ToolSearch "select:mcp__pixel-ofis__ofis_mesaj").'
      : 'Bu dosyalara dokunmadan önce güncel hâlini oku ve onların değişikliğini geri alma.',
  ].join('\n')
}

// ---- Compaction ----------------------------------------------------------------------

// What a compaction's summary must keep, told from the board: what the chat is for,
// what it was asked lately and which files it changed.
export const COMPACT_MARK = 'Piksel Ofis panosuna göre bu sohbet:'

export function compactInstructions(info: BoardInfo, project: string): string | null {
  if (!info.purpose && info.tasks.length === 0 && info.files.length === 0) return null
  const lines = [COMPACT_MARK]
  if (info.name) lines.push(`- Adı: ${info.name}`)
  if (info.purpose) lines.push(`- Amacı: ${info.purpose}`)
  if (info.tasks.length > 0) lines.push(`- Son görevleri: ${info.tasks.join(' | ')}`)
  if (info.files.length > 0) lines.push(`- Değiştirdiği dosyalar: ${filesLine(info.files, project, MAX_FILES)}`)
  lines.push('Özette bunları, verilen kararları ve yarım kalan işleri koru; dosya içeriklerini değil, yollarını tut.')

  return lines.join('\n')
}

// ---- A held Write: the file's uncommitted changes ------------------------------------

const DIFF_LINES = 60
const DIFF_CHARS = 4000

// `git diff` of the file, cut to what is worth reading in a refusal.
export function clipDiff(diff: string): string {
  const lines = diff.replace(/\r\n/g, '\n').split('\n').filter(line => !/^(diff --git|index |--- |\+\+\+ )/.test(line))
  let kept = lines.slice(0, DIFF_LINES).join('\n').trim()
  if (kept.length > DIFF_CHARS) kept = `${kept.slice(0, DIFF_CHARS)}\n…`
  else if (lines.length > DIFF_LINES) kept += `\n… (+${lines.length - DIFF_LINES} satır)`

  return kept
}

export function heldWriteText(conflicts: Conflict[], diff: string, now: number): string {
  const seen = diff
    ? `\nDosyanın commit edilmemiş değişiklikleri (onlarınki burada):\n\`\`\`diff\n${diff}\n\`\`\``
    : ''

  return (
    `${conflictText(conflicts, now)}${seen}\n` +
    'Dosyanın tamamını yeniden yazmak yerine Edit ile yalnız kendi değiştireceğin yeri değiştir: onların değişikliği korunur, ' +
    'tüm dosyayı yeniden üretmek gerekmez. Write gerçekten gerekiyorsa dosyanın güncel hâlini Read ile oku ve Write\'ı yeniden çağır.'
  )
}

// ---- Findings: subagent reports other chats may reuse --------------------------------

export const FINDING_WINDOW_MS = 2 * 60 * 60 * 1000
export const FINDING_SUMMARY = 1500
// Two research briefs this alike are taken for the same question.
const SAME_BRIEF = 0.6
const MIN_WORDS = 4

const words = (text: string): Set<string> =>
  new Set(
    text
      .toLocaleLowerCase('tr')
      .split(/[^\p{L}\p{N}_]+/u)
      .filter(word => word.length >= 3),
  )

// How alike two briefs are: the words they share over the shorter one's words.
export function briefLikeness(a: string, b: string): number {
  const left = words(a)
  const right = words(b)
  const small = Math.min(left.size, right.size)
  if (small < MIN_WORDS) return 0
  let shared = 0
  for (const word of left) if (right.has(word)) shared += 1

  return shared / small
}

// Another chat's report on the same question in the same project, lately: the best one.
export function matchingFinding(brief: string, project: string, findings: Finding[], now: number): Finding | null {
  let best: { finding: Finding; score: number } | null = null
  for (const finding of findings) {
    if (now - finding.at > FINDING_WINDOW_MS) continue
    if (project && finding.project && finding.project.toLowerCase() !== project.toLowerCase()) continue
    const score = briefLikeness(brief, `${finding.description} ${finding.prompt}`)
    if (score >= SAME_BRIEF && (!best || score > best.score)) best = { finding, score }
  }

  return best?.finding ?? null
}

export function findingText(finding: Finding, now: number): string {
  return (
    `Piksel Ofis: ${finding.label || 'başka bir sohbet'} bu soruyu ${ago(finding.at, now)} bir alt ajana (${finding.type}) araştırttı: "${finding.description}". ` +
    `Raporunun başı:\n<<<\n${finding.summary}\n>>>\n` +
    'Bu yeterliyse alt ajanı başlatma, bununla devam et. Yetmiyorsa ya da güncel olmayabilirse aynı Agent çağrısını yeniden yap: ikinci çağrı durdurulmaz.'
  )
}

export function parseFindings(text: string): Finding[] {
  try {
    const value = JSON.parse(text) as unknown
    if (!Array.isArray(value)) return []

    return value.filter(
      (one): one is Finding =>
        typeof one === 'object' && one !== null && typeof (one as Finding).id === 'string' && typeof (one as Finding).summary === 'string',
    )
  } catch {
    return []
  }
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
