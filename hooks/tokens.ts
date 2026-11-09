import type { TokenStats, TurnTokens } from '../types'

// The prompt cache's clock, kept as plain numbers: pure helpers the hooks module feeds.

export const EMPTY_TOKENS: TokenStats = { last: null, lastResponseAt: null }

export const MINUTE = 60 * 1000
export const SHORT_TTL = 5 * MINUTE
export const LONG_TTL = 60 * MINUTE

type ApiUsage = { input_tokens: number; output_tokens: number; cache_read_input_tokens: number; cache_creation_input_tokens: number }

export const fromUsage = (usage: ApiUsage): TurnTokens => ({
  input: usage.input_tokens,
  cacheRead: usage.cache_read_input_tokens,
  cacheWrite: usage.cache_creation_input_tokens,
  output: usage.output_tokens,
})

export function withTurn(stats: TokenStats, turn: TurnTokens, at: number): TokenStats {
  return { ...stats, last: turn, lastResponseAt: at }
}

// The share of the prompt the cache served: the rest was paid in full or written anew.
export function hitPercent(turn: TurnTokens | null): number | null {
  if (!turn) return null
  const prompt = turn.input + turn.cacheRead + turn.cacheWrite
  if (prompt === 0) return null

  return Math.round((turn.cacheRead / prompt) * 100)
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
