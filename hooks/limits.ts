import type { LimitReading } from '../types'

// The rate-limit windows belong to the account, not to a chat: every chat spends them,
// but each hears of them only from its own responses. So a chat that sits idle keeps
// showing the figure of its last answer while the others spend on. The chats share
// their readings in one file of the live folder, and each shows the latest of them.

// Two readings of one kind whose resets lie this close describe one window: the reset
// a response reports may drift between responses.
const SAME_WINDOW_MS = 10 * 60 * 1000

const resetOf = (reading: LimitReading): number | null => {
  const at = reading.resetsAt ? Date.parse(reading.resetsAt) : Number.NaN

  return Number.isFinite(at) ? at : null
}

// The later of two readings of one kind. A window with a later reset is a newer window;
// within one window the use only grows until it resets, so the higher reading is the
// later one, whichever chat took it and whenever it was written down.
function later(a: LimitReading, b: LimitReading): LimitReading {
  const resetA = resetOf(a)
  const resetB = resetOf(b)
  if (resetA !== null && resetB !== null && Math.abs(resetA - resetB) > SAME_WINDOW_MS) return resetA > resetB ? a : b
  const higher = b.percentUsed > a.percentUsed ? b : a
  const resetsAt = resetA !== null && resetB !== null ? (resetA >= resetB ? a.resetsAt : b.resetsAt) : (a.resetsAt ?? b.resetsAt)

  return { kind: higher.kind, percentUsed: higher.percentUsed, resetsAt: resetsAt ?? null }
}

// Both lists' kinds, each at its latest reading, in the order they first appear.
export function mergeLimits(base: LimitReading[], more: LimitReading[]): LimitReading[] {
  const merged = new Map<string, LimitReading>()
  for (const reading of [...base, ...more]) {
    const held = merged.get(reading.kind)
    merged.set(reading.kind, held ? later(held, reading) : reading)
  }

  return [...merged.values()]
}

// The readings as they stand now: a window whose reset has passed starts over empty.
export function currentLimits(readings: LimitReading[], now: number): LimitReading[] {
  return readings.map(reading => {
    const reset = resetOf(reading)

    return reset !== null && reset <= now ? { ...reading, percentUsed: 0, resetsAt: null } : reading
  })
}

const isReading = (value: unknown): value is LimitReading => {
  if (!value || typeof value !== 'object') return false
  const one = value as Record<string, unknown>

  return (
    typeof one.kind === 'string' &&
    typeof one.percentUsed === 'number' &&
    Number.isFinite(one.percentUsed) &&
    (one.resetsAt === null || one.resetsAt === undefined || typeof one.resetsAt === 'string')
  )
}

// The shared file's readings; none when it is missing or written by something else.
export function parseLimits(text: string): LimitReading[] {
  try {
    const body: unknown = JSON.parse(text)
    const list = body && typeof body === 'object' ? (body as { readings?: unknown }).readings : undefined
    if (!Array.isArray(list)) return []

    return list.filter(isReading).map(one => ({ kind: one.kind, percentUsed: one.percentUsed, resetsAt: one.resetsAt ?? null }))
  } catch {
    return []
  }
}

export const limitsText = (readings: LimitReading[]): string => JSON.stringify({ readings })
