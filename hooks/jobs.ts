import type { Job, JobStatus, SharedJob } from '../types'

// Background jobs: what each chat left running, how they ended and what they wrote.
// Pure helpers; the hooks module tracks the jobs and reads their files.

// A finished job stays on the list this long, so its end and its output can be seen.
export const JOB_KEPT_MS = 30 * 60 * 1000
export const JOBS_KEPT = 20
// Finished jobs listed under the running ones, newest first.
export const ENDED_SHOWN = 5
// One page of output: the Code element draws 100000 characters in all.
export const PAGE_BYTES = 80_000
const PAGE_CHARS = 90_000
// A stop another chat asked for counts this long: an old request stops nothing new.
export const STOP_REQUEST_MS = 10 * 60 * 1000

export const isLive = (status: JobStatus): boolean => status === 'running' || status === 'stopping'

const STATUS_WORDS: Record<JobStatus, string> = {
  running: 'çalışıyor',
  stopping: 'durduruluyor',
  completed: 'bitti',
  failed: 'hata verdi',
  killed: 'durduruldu',
  ended: 'bitti',
}

export const jobStatusWord = (status: JobStatus): string => STATUS_WORDS[status]

export const KIND_WORDS: Record<Job['kind'], string> = { shell: 'Komut', monitor: 'İzleyici', agent: 'Alt ajan' }

// `3 sn`, `4 dk 12 sn`, `2 sa 5 dk`.
export function durationText(ms: number): string {
  const seconds = Math.max(0, Math.floor(ms / 1000))
  if (seconds < 60) return `${seconds} sn`
  const minutes = Math.floor(seconds / 60)
  if (minutes < 60) return `${minutes} dk ${seconds % 60} sn`

  return `${Math.floor(minutes / 60)} sa ${minutes % 60} dk`
}

// Where a background command writes, as its result tells the model.
export function outputPathFrom(text: string | undefined): string | null {
  const found = /Output is being written to:\s*(.+?\.output)\b/.exec(text ?? '')

  return found?.[1]?.trim() ?? null
}

// The folder a path lies in, in the path's own spelling.
export const dirOf = (path: string): string => path.replace(/[\\/][^\\/]*$/, '')

// How a task's notification word reads as a job's end; null while it still runs.
export function endedStatus(word: string): JobStatus | null {
  const status = word.trim().toLowerCase()
  if (!status || status === 'running' || status === 'pending' || status === 'working') return null
  if (status === 'completed') return 'completed'
  if (status === 'failed' || status === 'error') return 'failed'
  if (status === 'killed' || status === 'stopped') return 'killed'

  return 'ended'
}

export type TaskNotice = { id: string; status: JobStatus; summary: string }

// The task notifications a prompt carries: `<task-notification>` blocks, each with
// its `<task-id>` and, once the task ended, its `<status>`.
export function parseNotices(text: string): TaskNotice[] {
  const found: TaskNotice[] = []
  for (const block of text.split('<task-notification>').slice(1)) {
    const body = block.split('</task-notification>')[0] ?? ''
    const id = /<task-id>([^<]+)<\/task-id>/.exec(body)?.[1]?.trim()
    const word = /<status>([^<]+)<\/status>/.exec(body)?.[1] ?? ''
    const status = endedStatus(word)
    if (!id || !status) continue
    const summary = /<summary>([^<]*)<\/summary>/.exec(body)?.[1]?.trim() ?? ''
    found.push({ id, status, summary })
  }

  return found
}

// Puts `job` on the list, or refreshes the one with its id.
export function withJob(list: Job[], job: Job): Job[] {
  return [job, ...list.filter(one => one.id !== job.id)].slice(0, JOBS_KEPT)
}

export function changeJob(list: Job[], id: string, change: (job: Job) => Job): Job[] {
  return list.some(job => job.id === id) ? list.map(job => (job.id === id ? change(job) : job)) : list
}

export const ended = (job: Job, status: JobStatus, at: number, summary = ''): Job =>
  isLive(job.status) ? { ...job, status, endedAt: at, summary: summary || job.summary } : job

// Finished jobs leave the list once they are old.
export const prunedJobs = (list: Job[], now: number): Job[] =>
  list.filter(job => isLive(job.status) || job.endedAt === null || now - job.endedAt < JOB_KEPT_MS)

// The order of the list: the running ones first, the longest running at the top (the
// one most likely forgotten), then the finished ones, the latest first.
export function sortedJobs(jobs: SharedJob[]): SharedJob[] {
  const running = jobs.filter(job => isLive(job.status)).sort((a, b) => a.startedAt - b.startedAt)
  const done = jobs
    .filter(job => !isLive(job.status))
    .sort((a, b) => (b.endedAt ?? 0) - (a.endedAt ?? 0))
    .slice(0, ENDED_SHOWN)

  return [...running, ...done]
}

export const jobKey = (job: { sessionId: string; id: string }): string => `${job.sessionId}:${job.id}`

// What a background shell wrote, as plain text a Code element draws: colour codes and
// other control characters out, a line a progress bar rewrote kept as it last stood.
export function cleanOutput(text: string): string {
  return text
    .replace(/\u001b\[[0-?]*[ -/]*[@-~]/g, '')
    .replace(/\u001b\][^\u0007\u001b]*(\u0007|\u001b\\)/g, '')
    .replace(/\r\n/g, '\n')
    .split('\n')
    .map(line => line.slice(line.lastIndexOf('\r') + 1))
    .join('\n')
    .replace(/[\u0000-\u0008\u000b-\u001f\u007f]/g, '')
}

type Block = { type?: unknown; text?: unknown; name?: unknown; input?: unknown; content?: unknown }

const oneLine = (text: string, max: number): string => {
  const flat = text.replace(/\s+/g, ' ').trim()

  return flat.length > max ? `${flat.slice(0, max - 1)}…` : flat
}

function resultText(content: unknown): string {
  if (typeof content === 'string') return content
  if (!Array.isArray(content)) return ''

  return (content as Block[]).map(block => (typeof block.text === 'string' ? block.text : '')).join(' ')
}

function toolLine(block: Block): string {
  const input = (block.input ?? {}) as Record<string, unknown>
  const name = typeof block.name === 'string' ? block.name : 'araç'
  const said = ['description', 'command', 'file_path', 'pattern', 'query', 'url', 'prompt']
    .map(field => input[field])
    .find((value): value is string => typeof value === 'string' && value.length > 0)

  return `▶ ${name}${said ? `: ${oneLine(said, 200)}` : ''}`
}

// A subagent's transcript as a log a person reads: what it said, each tool it called
// and the start of each result. Lines that are no JSON (a cut first line) are skipped.
export function agentLog(jsonl: string): string {
  const out: string[] = []
  for (const line of jsonl.split('\n')) {
    if (!line.trim()) continue
    let row: { type?: unknown; message?: { content?: unknown } }
    try {
      row = JSON.parse(line) as typeof row
    } catch {
      continue
    }
    const content = row.message?.content
    if (row.type === 'user' && typeof content === 'string') {
      out.push(`— Görev —\n${content.trim()}`)
      continue
    }
    if (!Array.isArray(content)) continue
    for (const block of content as Block[]) {
      if (row.type === 'assistant' && block.type === 'text' && typeof block.text === 'string' && block.text.trim()) out.push(block.text.trim())
      else if (row.type === 'assistant' && block.type === 'tool_use') out.push(toolLine(block))
      else if (row.type === 'user' && block.type === 'tool_result') {
        const said = oneLine(resultText(block.content), 300)
        if (said) out.push(`  ↳ ${said}`)
      }
    }
  }

  return out.join('\n')
}

// One page of a job's output: `page` 0 is the newest. A page that starts mid-file
// drops its first, cut line.
export type OutputPage = { text: string; page: number; pages: number; size: number }

export function pageRange(size: number, page: number): { start: number; end: number; page: number; pages: number } {
  const pages = Math.max(1, Math.ceil(size / PAGE_BYTES))
  const at = Math.min(Math.max(0, page), pages - 1)
  const end = Math.max(0, size - at * PAGE_BYTES)
  const start = Math.max(0, end - PAGE_BYTES)

  return { start, end, page: at, pages }
}

export function pageText(raw: string, isCut: boolean, isTranscript: boolean): string {
  const whole = isCut ? raw.slice(raw.indexOf('\n') + 1) : raw
  const text = isTranscript ? agentLog(whole) : cleanOutput(whole)

  return text.length > PAGE_CHARS ? text.slice(-PAGE_CHARS) : text
}

// Stop requests another chat left for this one: task id → when it was asked.
export function parseStops(text: string): Record<string, number> {
  try {
    const value = JSON.parse(text) as unknown
    if (!value || typeof value !== 'object' || Array.isArray(value)) return {}
    const out: Record<string, number> = {}
    for (const [id, at] of Object.entries(value as Record<string, unknown>)) if (typeof at === 'number') out[id] = at

    return out
  } catch {
    return {}
  }
}

export function parseJobs(value: unknown): Job[] {
  if (!Array.isArray(value)) return []

  return value.filter(
    (job): job is Job =>
      !!job &&
      typeof job === 'object' &&
      typeof (job as Job).id === 'string' &&
      typeof (job as Job).status === 'string' &&
      typeof (job as Job).startedAt === 'number',
  )
}
