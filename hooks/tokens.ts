import type { FixedLoad, HeavyOutput, LoadRow, TokenStats, TurnTokens } from '../types'

// What this chat spends, kept as plain numbers: pure helpers the hooks module feeds.

export const ZERO: TurnTokens = { input: 0, cacheRead: 0, cacheWrite: 0, output: 0 }
export const EMPTY_TOKENS: TokenStats = { last: null, total: ZERO, turns: 0, heavy: [], byTool: {}, lastResponseAt: null }

// A tool result is worth naming once it is this long (about a thousand tokens).
export const HEAVY_CHARS = 4000
const HEAVY_KEPT = 5

export const MINUTE = 60 * 1000
export const SHORT_TTL = 5 * MINUTE
export const LONG_TTL = 60 * MINUTE

// Characters to tokens, as a rough reading: English and code run near four a token.
export const approxTokens = (chars: number): number => Math.round(chars / 4)

export const kilo = (tokens: number): string => (tokens >= 1000 ? `${(tokens / 1000).toFixed(tokens >= 10000 ? 0 : 1)}k` : String(tokens))

type ApiUsage = { input_tokens: number; output_tokens: number; cache_read_input_tokens: number; cache_creation_input_tokens: number }

export const fromUsage = (usage: ApiUsage): TurnTokens => ({
  input: usage.input_tokens,
  cacheRead: usage.cache_read_input_tokens,
  cacheWrite: usage.cache_creation_input_tokens,
  output: usage.output_tokens,
})

const plus = (a: TurnTokens, b: TurnTokens): TurnTokens => ({
  input: a.input + b.input,
  cacheRead: a.cacheRead + b.cacheRead,
  cacheWrite: a.cacheWrite + b.cacheWrite,
  output: a.output + b.output,
})

export function withTurn(stats: TokenStats, turn: TurnTokens, at: number): TokenStats {
  return { ...stats, last: turn, total: plus(stats.total, turn), turns: stats.turns + 1, lastResponseAt: at }
}

// The share of the prompt the cache served: the rest was paid in full or written anew.
export function hitPercent(turn: TurnTokens | null): number | null {
  if (!turn) return null
  const prompt = turn.input + turn.cacheRead + turn.cacheWrite
  if (prompt === 0) return null

  return Math.round((turn.cacheRead / prompt) * 100)
}

export function withOutput(stats: TokenStats, output: HeavyOutput): TokenStats {
  const byTool = { ...stats.byTool, [output.tool]: (stats.byTool[output.tool] ?? 0) + output.chars }
  if (output.chars < HEAVY_CHARS) return { ...stats, byTool }
  const heavy = [...stats.heavy, output].sort((a, b) => b.chars - a.chars).slice(0, HEAVY_KEPT)

  return { ...stats, byTool, heavy }
}

const clip = (text: string, max: number): string => {
  const flat = text.replace(/\s+/g, ' ').trim()

  return flat.length > max ? `${flat.slice(0, max - 1)}…` : flat
}

const lastPart = (path: string): string => path.replace(/[\\/]+$/, '').split(/[\\/]/).pop() ?? path

// What a tool call was about, in a few words: the file, the command, the pattern.
export function callLabel(tool: string, input: unknown): string {
  const fields = (input ?? {}) as Record<string, unknown>
  const text = (key: string): string => (typeof fields[key] === 'string' ? (fields[key] as string) : '')
  if (text('file_path')) return lastPart(text('file_path'))
  if (text('notebook_path')) return lastPart(text('notebook_path'))
  if (text('command')) return clip(text('command'), 32)
  if (text('pattern')) return clip(text('pattern'), 32)
  if (text('url')) return clip(text('url').replace(/^https?:\/\//, ''), 32)
  if (text('query')) return clip(text('query'), 32)
  if (text('description')) return clip(text('description'), 32)

  return tool.startsWith('mcp__') ? tool.split('__').slice(2).join('_') : ''
}

type Breakdown = {
  categories: readonly { name: string; tokens: number; kind: string }[]
  memoryFiles: readonly { path: string; type: string; tokens: number }[]
}

// The load every request carries before the conversation: the rows /context lists
// as used, the conversation's own row aside, and the three largest memory files.
export function fixedLoad(breakdown: Breakdown, at: number): FixedLoad {
  const rows: LoadRow[] = breakdown.categories
    .filter(row => row.kind === 'used' && row.tokens > 0 && !/^messages$/i.test(row.name))
    .map(row => ({ name: row.name, tokens: row.tokens }))
    .sort((a, b) => b.tokens - a.tokens)
  const memory: LoadRow[] = [...breakdown.memoryFiles]
    .sort((a, b) => b.tokens - a.tokens)
    .slice(0, 3)
    .map(file => ({ name: `${lastPart(file.path)} (${file.type})`, tokens: file.tokens }))

  return { rows, memory, measuredAt: at }
}

export type Warmth = { state: 'unknown' | 'warm' | 'cooling' | 'cold'; minutes: number; ttl: number | null }

// How likely the next request finds its prefix in the prompt cache, by the time since
// the main loop last heard from the model. The lifetime is learned once a long pause
// was seen; until then a pause past five minutes may or may not have cost the cache.
export function warmth(lastResponseAt: number | null, ttl: number | null, now: number): Warmth {
  if (lastResponseAt === null) return { state: 'unknown', minutes: 0, ttl }
  const elapsed = Math.max(0, now - lastResponseAt)
  const minutes = Math.floor(elapsed / MINUTE)
  if (ttl !== null) {
    if (elapsed >= ttl) return { state: 'cold', minutes, ttl }

    return { state: elapsed >= ttl * 0.8 ? 'cooling' : 'warm', minutes, ttl }
  }
  if (elapsed < SHORT_TTL) return { state: 'warm', minutes, ttl }

  return { state: elapsed < LONG_TTL ? 'cooling' : 'cold', minutes, ttl }
}

// After a pause longer than the short lifetime, what the turn wrote to the cache
// against what the context held tells which lifetime the cache has: a prefix read
// back means the long one, a prefix written anew the short one. Null: no verdict.
export function learnTtl(pauseMs: number, contextTokens: number | null, turn: TurnTokens): number | null {
  if (pauseMs <= SHORT_TTL + MINUTE / 2 || pauseMs >= LONG_TTL) return null
  if (contextTokens === null || contextTokens < 10000) return null
  if (turn.cacheWrite >= contextTokens * 0.5) return SHORT_TTL
  if (turn.cacheWrite <= contextTokens * 0.2 && turn.cacheRead >= contextTokens * 0.5) return LONG_TTL

  return null
}

export function warmthText(heat: Warmth): string {
  const life = heat.ttl === null ? '' : heat.ttl >= LONG_TTL ? ' (1 sa)' : ' (5 dk)'
  if (heat.state === 'unknown') return 'ilk yanıt bekleniyor'
  if (heat.state === 'warm') return `sıcak, ${heat.minutes} dk${life}`
  if (heat.state === 'cold') return `soğudu, ${heat.minutes} dk${life}`
  if (heat.ttl === null) return `ılık, ${heat.minutes} dk (5 dk'lık önbellekte soğudu)`

  return `soğumak üzere, ${heat.minutes} dk${life}`
}
