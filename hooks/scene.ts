import type { Station, Team, Usage, Worker } from '../types'

// The prompt cache as the HUD shows it: how warm, in words, and the last turn's hit.
export type CacheGauge = { state: 'unknown' | 'warm' | 'cooling' | 'cold'; text: string; hit: number | null }

// The office is drawn on a 320x322 grid: the room on 0..180, the waiting room on
// 180..248, the meters below.
const W = 320
const ROOM_H = 180
const WAIT_TOP = 180
const HUD_TOP = 248
const H = 322

// A chat that waits this long for its next task leaves through the door; from the
// second value on it stands at the door, on its way out.
export const LEAVE_AFTER_MS = 30 * 60 * 1000
export const LEAVING_FROM_MS = 27 * 60 * 1000

type Point = { x: number; y: number }

// Where a worker stands (sprite top-left, sprite 16x24) at each station.
const SLOTS: Record<Station, Point[]> = {
  desk: [
    { x: 104, y: 98 },
    { x: 160, y: 98 },
    { x: 216, y: 98 },
  ],
  shelf: [
    { x: 14, y: 80 },
    { x: 34, y: 84 },
    { x: 54, y: 80 },
  ],
  terminal: [
    { x: 284, y: 86 },
    { x: 264, y: 90 },
    { x: 246, y: 86 },
  ],
  web: [
    { x: 64, y: 128 },
    { x: 80, y: 134 },
    { x: 46, y: 150 },
  ],
  board: [
    { x: 150, y: 54 },
    { x: 172, y: 56 },
    { x: 194, y: 54 },
  ],
  coffee: [
    { x: 240, y: 144 },
    { x: 222, y: 148 },
    { x: 204, y: 144 },
    { x: 186, y: 148 },
    { x: 168, y: 144 },
    { x: 150, y: 148 },
  ],
}

const DESKS_X = [84, 140, 196]

const SPRITE = [
  '..hhhh..',
  '.hhhhhh.',
  'hhsssshh',
  '.skssks.',
  '.ssssss.',
  '..ssss..',
  '.cccccc.',
  'cccccccc',
  'sccccccs',
  '.pppppp.',
  '.pp..pp.',
  '.bb..bb.',
]

type Look = { h: string; s: string; c: string; p: string }

const MAIN_LOOK: Look = { h: '#3a2a1e', s: '#f1c27d', c: '#d97757', p: '#3b4a6b' }

const LOOKS: Look[] = [
  { h: '#e0c068', s: '#e0ac69', c: '#4a90d9', p: '#2f3b52' },
  { h: '#8b3a2f', s: '#c68642', c: '#5bb56a', p: '#3d3328' },
  { h: '#222222', s: '#f1c27d', c: '#b06fd6', p: '#333a4d' },
  { h: '#c96b2c', s: '#8d5524', c: '#e0d14a', p: '#2c3e50' },
  { h: '#6d6d6d', s: '#e0ac69', c: '#e05a7a', p: '#283040' },
  { h: '#f2e3c6', s: '#c68642', c: '#3fb0b0', p: '#40354a' },
]

const STYLE = `<style>
.work{animation:bob .5s steps(2,end) infinite}
.idle{animation:sway 2.4s steps(2,end) infinite}
@keyframes bob{50%{transform:translateY(-2px)}}
@keyframes sway{50%{transform:translateX(1px)}}
.led{animation:led 1.2s steps(2,end) infinite}
.led2{animation:led .7s steps(2,end) infinite}
@keyframes led{50%{opacity:.15}}
.scr{animation:scr .8s steps(2,end) infinite}
@keyframes scr{50%{opacity:.55}}
.steam{animation:steam 2s linear infinite}
@keyframes steam{0%{transform:translateY(0);opacity:.8}100%{transform:translateY(-8px);opacity:0}}
.done{opacity:.55}
text{font-family:'Courier New',Consolas,monospace;font-weight:bold}
</style>`

const r = (x: number, y: number, w: number, h: number, fill: string, cls = ''): string =>
  `<rect x="${x}" y="${y}" width="${w}" height="${h}" fill="${fill}"${cls ? ` class="${cls}"` : ''}/>`

const esc = (text: string): string =>
  text.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;')

const label = (x: number, y: number, text: string, size = 5, fill = '#e8dcc0', anchor = 'middle'): string =>
  `<text x="${x}" y="${y}" font-size="${size}" fill="${fill}" text-anchor="${anchor}">${esc(text)}</text>`

function sprite(x: number, y: number, look: Look, cls: string, badge: string | null): string {
  const colors: Record<string, string> = { ...look, k: '#1a1a1a', b: '#2a1d14' }
  let body = ''
  SPRITE.forEach((row, py) => {
    let px = 0
    while (px < row.length) {
      const key = row[px] ?? '.'
      let run = 1
      while (px + run < row.length && row[px + run] === key) run += 1
      if (key !== '.') body += r(px * 2, py * 2, run * 2, 2, colors[key] ?? '#000000')
      px += run
    }
  })
  // Each chat's chief wears its team's badge.
  if (badge) body += r(10, 14, 2, 2, badge)

  return `<g transform="translate(${x} ${y})"><g class="${cls}">${body}</g></g>`
}

function shortTool(tool: string): string {
  const name = tool.startsWith('mcp__') ? tool.split('__').slice(2).join('_') || tool : tool

  return name.length > 12 ? `${name.slice(0, 11)}…` : name
}

function bubbleText(worker: Worker): string {
  if (worker.status === 'error') return 'takıldı'
  if (worker.status === 'done') return 'bitti'
  if (worker.status === 'idle') return 'boşta'

  return worker.tool ? shortTool(worker.tool) : 'düşünüyor…'
}

function bubble(cx: number, top: number, text: string, isError: boolean): string {
  const width = text.length * 4 + 6
  const x = Math.min(Math.max(2, Math.round(cx - width / 2)), W - width - 2)
  const y = Math.max(1, top - 12)

  return (
    r(x, y, width, 9, '#1d1a26') +
    r(x + 1, y + 1, width - 2, 7, isError ? '#ffd6d6' : '#fffbe8') +
    r(Math.round(cx) - 1, y + 9, 2, 2, '#1d1a26') +
    label(x + width / 2, y + 6.6, text, 6, isError ? '#a01818' : '#1d1a26')
  )
}

// A name kept inside the drawing: one near an edge moves in rather than being cut.
function nameTag(cx: number, y: number, text: string): string {
  const half = (text.length * 3.4) / 2 + 1
  const x = Math.min(Math.max(cx, half), W - half)

  return `<text x="${x}" y="${y}" font-size="5.5" fill="#ffffff" stroke="#1d1a26" stroke-width="1.6" paint-order="stroke" text-anchor="middle">${esc(text)}</text>`
}

function whiteboard(teams: Team[]): string {
  let out = r(140, 8, 76, 38, '#9aa3ad') + r(142, 10, 72, 34, '#eef1f4')
  const tasks = teams.filter(team => team.task && team.waitingMs === null).slice(0, 3)
  if (tasks.length === 0) {
    out += r(146, 15, 30, 2, '#4a90d9') + r(146, 21, 44, 2, '#5bb56a') + r(146, 27, 22, 2, '#e05a7a')
    out += r(180, 30, 26, 10, '#ffe08a') + r(184, 33, 18, 2, '#c9a23a')

    return out + label(196, 18, 'PLAN', 6, '#3b2f4a')
  }
  out += label(178, 15.5, 'GÖREVLER', 4.5, '#3b2f4a')
  tasks.forEach((team, i) => {
    const y = 23 + i * 7.5
    out += r(144, y - 3.5, 3, 3, team.color === '#ffd700' ? '#c9a23a' : team.color)
    out += label(149, y, clipText(team.task, 21), 4.5, '#1d1a26', 'start')
  })

  return out
}

const clipText = (text: string, max: number): string => (text.length > max ? `${text.slice(0, max - 1)}…` : text)

function corkBoard(teams: Team[]): string {
  let out = r(222, 8, 48, 40, '#6b3f1f') + r(224, 10, 44, 36, '#c8955a')
  for (let i = 0; i < 9; i += 1) out += r(228 + ((i * 13) % 38), 14 + ((i * 7) % 28), 1, 1, '#a8743f')
  out += label(246, 15.5, 'PANO', 4.5, '#3b2412')
  teams.slice(0, 6).forEach((team, i) => {
    const x = 226 + (i % 3) * 14
    const y = 18 + Math.floor(i / 3) * 14
    out += r(x + 1, y + 1, 12, 12, '#7a4a22') + r(x, y, 12, 12, team.color)
    out += r(x + 5, y - 1, 2, 2, '#c0392b')
    out += label(x + 6, y + 5.5, team.label || '★', 4.5, '#1d1a26')
    out += label(x + 6, y + 10.5, `${team.files}d`, 4, '#3b2412')
  })

  return out
}

function room(teams: Team[], cache: CacheGauge | null): string {
  let out = ''
  // Wall and floor.
  out += r(0, 0, W, 56, '#3b2f4a')
  for (let x = 8; x < W; x += 16) out += r(x, 0, 1, 50, '#433654')
  out += r(0, 50, W, 6, '#2a2135')
  out += r(0, 56, W, ROOM_H - 56, '#6b4f3a')
  for (let y = 64; y < ROOM_H; y += 8) out += r(0, y, W, 1, '#5e4533')
  for (let y = 56, row = 0; y < ROOM_H; y += 8, row += 1) {
    for (let x = row % 2 ? 20 : 0; x < W; x += 40) out += r(x, y, 1, 8, '#5e4533')
  }
  // Rug.
  out += r(98, 140, 108, 36, '#5a2b2b') + r(101, 143, 102, 30, '#7a3b3b')
  for (let x = 106; x < 200; x += 12) out += r(x, 157, 6, 2, '#a35a4a')

  // Window.
  out += r(62, 8, 48, 34, '#c9b48a') + r(65, 11, 20, 28, '#7ec8e3') + r(87, 11, 20, 28, '#7ec8e3')
  out += r(68, 16, 10, 3, '#ffffff') + r(72, 14, 6, 2, '#ffffff') + r(92, 24, 9, 3, '#ffffff')
  out += r(60, 42, 52, 3, '#a8946c')

  // Clock.
  out += r(118, 12, 14, 14, '#1d1a26') + r(119, 13, 12, 12, '#f4ead5')
  out += r(124, 15, 2, 5, '#1d1a26') + r(124, 19, 4, 2, '#1d1a26')

  // Whiteboard: the chats' current tasks.
  out += whiteboard(teams)

  // Cork board: a note per chat, its label and how many files it changed.
  out += corkBoard(teams)

  // Bookshelf.
  out += r(8, 14, 46, 64, '#5a3418') + r(10, 16, 42, 60, '#7a4a2a')
  const books = ['#c0392b', '#2980b9', '#27ae60', '#8e44ad', '#f39c12', '#16a085', '#d35400']
  for (const shelfY of [18, 36, 54]) {
    let x = 12
    let i = shelfY
    while (x < 50) {
      const bw = 3 + (i % 3)
      const bh = 12 + (i % 4)
      out += r(x, shelfY + 16 - bh, bw, bh, books[i % books.length] ?? '#c0392b')
      x += bw + 1
      i += 5
    }
    out += r(10, shelfY + 16, 42, 2, '#5a3418')
  }
  out += label(31, 12, 'ARŞİV')

  // Server rack.
  out += r(276, 18, 38, 68, '#1b1e23') + r(278, 20, 34, 64, '#2b2f36')
  for (let y = 24, i = 0; y < 80; y += 9, i += 1) {
    out += r(280, y, 30, 7, '#3a3f48') + r(283, y + 2, 12, 2, '#20242a')
    out += r(300, y + 2, 2, 2, '#58f087', i % 2 ? 'led' : 'led2')
    out += r(304, y + 2, 2, 2, i % 3 ? '#f0c419' : '#58f087', i % 2 ? 'led2' : 'led')
  }
  out += label(295, 14, 'SUNUCU')

  // Globe table.
  out += r(40, 148, 30, 4, '#8b5a2b') + r(42, 152, 3, 12, '#5a3418') + r(65, 152, 3, 12, '#5a3418')
  out += r(48, 128, 14, 14, '#1d1a26') + r(49, 129, 12, 12, '#3a7bd5')
  out += r(51, 131, 5, 3, '#4caf50') + r(55, 135, 4, 4, '#4caf50') + r(52, 138, 3, 2, '#4caf50')
  out += r(54, 142, 2, 4, '#5a3418') + r(50, 146, 10, 2, '#5a3418')
  out += label(55, 172, 'AĞ')

  // Coffee corner.
  out += r(262, 140, 52, 6, '#8b5a2b') + r(264, 146, 48, 22, '#74491f')
  out += r(270, 120, 18, 20, '#2b2f36') + r(272, 123, 14, 6, '#5a5f68') + r(276, 133, 6, 7, '#f4ead5')
  // The coffee steams while the prompt cache is warm, and goes cold with it.
  const heat = cache?.state ?? 'unknown'
  if (heat === 'warm' || heat === 'unknown') out += r(277, 116, 2, 3, '#ffffff', 'steam') + r(281, 114, 2, 3, '#ffffff', 'steam')
  else if (heat === 'cooling') out += r(279, 115, 2, 3, '#cfd6dd', 'steam')
  else out += r(276, 133, 6, 2, '#6b8fa8')
  out += r(296, 134, 6, 6, '#e05a7a') + r(304, 135, 6, 5, '#4a90d9')
  out += label(288, 176, 'KAFE')

  // Plant.
  out += r(6, 160, 12, 12, '#a0522d') + r(4, 146, 6, 14, '#3e8e41') + r(10, 140, 6, 20, '#4caf50') + r(15, 148, 5, 12, '#3e8e41')

  return out
}

function desks(working: boolean[]): string {
  let out = ''
  DESKS_X.forEach((x, i) => {
    out += r(x + 2, 100, 16, 12, '#22252b')
    out += working[i] ? r(x + 3, 101, 14, 9, '#7cfc9a', 'scr') + r(x + 4, 103, 8, 1, '#1d4d2a') + r(x + 4, 106, 10, 1, '#1d4d2a') : r(x + 3, 101, 14, 9, '#2e3440')
    out += r(x + 9, 112, 2, 4, '#22252b')
    out += r(x, 116, 44, 6, '#8b5a2b') + r(x + 2, 122, 40, 12, '#74491f') + r(x + 2, 134, 3, 4, '#5a3418') + r(x + 39, 134, 3, 4, '#5a3418')
  })

  return out
}

function countdown(resetsAt: string | null, now: number): string {
  if (!resetsAt) return ''
  const ms = Date.parse(resetsAt) - now
  if (!Number.isFinite(ms) || ms <= 0) return ''
  const minutes = Math.round(ms / 60000)
  const days = Math.floor(minutes / 1440)
  const hours = Math.floor((minutes % 1440) / 60)
  if (days > 0) return `${days}g ${hours}sa`

  return `${hours}sa ${minutes % 60}dk`
}

const LIMIT_NAMES: Record<string, string> = {
  five_hour: '5 SAAT',
  seven_day: '7 GÜN',
  seven_day_opus: '7G OPUS',
  seven_day_sonnet: '7G SONNET',
  spend_limit: 'HARCAMA',
}

function meter(y: number, name: string, percent: number | null, note: string): string {
  const segments = 15
  const filled = percent === null ? 0 : Math.min(segments, Math.round((percent / 100) * segments))
  const color = percent === null ? '#555' : percent >= 85 ? '#ff5c5c' : percent >= 60 ? '#f0c419' : '#58f087'
  let out = label(6, y + 5.5, name, 6, '#e8dcc0', 'start')
  for (let i = 0; i < segments; i += 1) out += r(64 + i * 10, y, 9, 7, i < filled ? color : '#2f2a3d')
  out += label(218, y + 5.5, percent === null ? '--' : `%${percent}`, 6, color, 'start')
  if (note) out += label(244, y + 5.5, note, 5.5, '#9a8fb0', 'start')

  return out
}

const HEAT_COLORS: Record<CacheGauge['state'], string> = { unknown: '#9a8fb0', warm: '#58f087', cooling: '#f0c419', cold: '#6bb8ff' }

function hud(usage: Usage | null, now: number, active: number, waiting: number, cache: CacheGauge | null): string {
  let out = r(0, HUD_TOP, W, H - HUD_TOP, '#1d1a26') + r(0, HUD_TOP, W, 2, '#5c4b7a')
  let y = HUD_TOP + 6
  const limits = usage?.limits ?? []
  if (limits.length === 0) {
    out += label(6, y + 5.5, 'LİMİT: ilk yanıttan sonra görünür', 6, '#9a8fb0', 'start')
    y += 11
  }
  for (const limit of limits.slice(0, 3)) {
    out += meter(y, LIMIT_NAMES[limit.kind] ?? limit.kind.toUpperCase().slice(0, 9), limit.percentUsed, countdown(limit.resetsAt, now))
    y += 11
  }
  const tokens = usage?.contextTokens
  const contextNote = tokens ? `${Math.round(tokens / 1000)}k/${Math.round((usage?.contextWindow ?? 0) / 1000)}k` : ''
  out += meter(y, 'BAĞLAM', usage?.contextPercent ?? null, contextNote)
  y += 11
  if (cache) {
    const hit = cache.hit === null ? '' : `  ·  İSABET %${cache.hit}`
    out += label(6, y + 5.5, 'ÖNBELLEK', 6, '#e8dcc0', 'start')
    out += r(64, y, 7, 7, HEAT_COLORS[cache.state])
    out += label(76, y + 5.5, `${cache.text}${hit}`, 5.5, HEAT_COLORS[cache.state], 'start')
    y += 11
  }
  const cost = usage?.usd !== null && usage?.usd !== undefined ? `MALİYET $${usage.usd.toFixed(2)}` : 'MALİYET --'
  const waitNote = waiting > 0 ? `   ·   BEKLEYEN: ${waiting}` : ''
  out += label(6, Math.min(y + 5.5, H - 3), `${cost}   ·   ÇALIŞAN: ${active}${waitNote}`, 6, '#e8dcc0', 'start')

  return out
}

const NAME_CHARS = 14

// A chat's chief carries the chat's title, shortened; a helper its role's name.
function shownName(team: Team, worker: Worker): string {
  if (worker.id !== 'main') return worker.name
  const title = team.title.replace(/\s+/g, ' ').trim()
  if (!title) return worker.name

  return title.length > NAME_CHARS ? `${title.slice(0, NAME_CHARS - 1).trimEnd()}…` : title
}

function waitText(ms: number): string {
  if (ms >= LEAVING_FROM_MS) return 'çıkıyor'
  const minutes = Math.floor(ms / 60000)

  return minutes < 1 ? 'az önce' : `${minutes} dk`
}

// ---- The waiting room: chats that finished and wait for their next task ------------

const SEATS_X = [8, 48, 88, 128, 168, 208]
const DOOR_X = 284
const SEAT_Y = 203
const AT_DOOR = 2

function waitingRoom(): string {
  let out = r(0, WAIT_TOP, W, 2, '#5c4b7a')
  // Wall, its stripes and the baseboard; the tiled floor.
  out += r(0, WAIT_TOP + 2, W, 22, '#2f3d4f')
  for (let x = 6; x < W; x += 12) out += r(x, WAIT_TOP + 2, 1, 22, '#36475b')
  out += r(0, WAIT_TOP + 24, W, 3, '#24303d')
  out += r(0, WAIT_TOP + 27, W, HUD_TOP - WAIT_TOP - 27, '#56606b')
  for (let y = WAIT_TOP + 37; y < HUD_TOP; y += 10) out += r(0, y, W, 1, '#4b545e')
  for (let y = WAIT_TOP + 27, row = 0; y < HUD_TOP; y += 10, row += 1) {
    for (let x = row % 2 ? 12 : 0; x < W; x += 24) out += r(x, y, 1, 10, '#4b545e')
  }
  // The sign.
  out += r(228, WAIT_TOP + 5, 52, 9, '#1d1a26') + r(229, WAIT_TOP + 6, 50, 7, '#3b2f4a')
  out += label(254, WAIT_TOP + 11.4, 'BEKLEME ODASI', 4.5, '#e8dcc0')
  // A table with magazines.
  out += r(236, 224, 24, 3, '#8b5a2b') + r(238, 227, 2, 9, '#5a3418') + r(256, 227, 2, 9, '#5a3418')
  out += r(239, 221, 9, 3, '#e05a7a') + r(249, 222, 8, 2, '#4a90d9')
  // The door out, with its sign.
  out += r(DOOR_X, WAIT_TOP + 4, 30, HUD_TOP - WAIT_TOP - 4, '#3a2414') + r(DOOR_X + 3, WAIT_TOP + 7, 24, HUD_TOP - WAIT_TOP - 7, '#8b5a2b')
  out += r(DOOR_X + 6, WAIT_TOP + 17, 18, 20, '#7a4d24') + r(DOOR_X + 6, WAIT_TOP + 41, 18, 22, '#7a4d24')
  out += r(DOOR_X + 22, WAIT_TOP + 38, 2, 2, '#f0c419')
  out += r(DOOR_X + 5, WAIT_TOP + 8, 20, 7, '#1e7a3a') + label(DOOR_X + 15, WAIT_TOP + 13.2, 'ÇIKIŞ', 4.5, '#d8ffd8')

  return out
}

const chairBack = (x: number): string => r(x - 1, 204, 18, 2, '#5a2b2b') + r(x - 1, 206, 18, 12, '#7a3b3b')

const chairSeat = (x: number): string =>
  r(x - 2, 219, 20, 4, '#8f4a4a') + r(x - 1, 223, 2, 9, '#3a2414') + r(x + 15, 223, 2, 9, '#3a2414')

type Waiting = { worker: Worker; name: string; look: Look; badge: string; waitingMs: number }

// The longest waiting nearest the door, those about to leave at it; the drawing and
// its name tags and bubbles, which go over everything.
function lounge(waiting: Waiting[]): { room: string; tags: string } {
  let room = waitingRoom()
  let tags = ''
  const queue = [...waiting].sort((a, b) => a.waitingMs - b.waitingMs)
  const leaving = queue.filter(one => one.waitingMs >= LEAVING_FROM_MS)
  const sitting = queue.filter(one => one.waitingMs < LEAVING_FROM_MS)
  const shown = sitting.slice(0, SEATS_X.length)
  for (const x of SEATS_X) room += chairBack(x)
  shown.forEach((one, i) => {
    room += sprite(SEATS_X[i] ?? 0, SEAT_Y, one.look, 'idle', one.badge)
  })
  for (const x of SEATS_X) room += chairSeat(x)
  shown.forEach((one, i) => {
    const cx = (SEATS_X[i] ?? 0) + 8
    const isError = one.worker.status === 'error'
    tags += nameTag(cx, i % 2 ? 245 : 239, one.name)
    tags += bubble(cx, SEAT_Y, isError ? 'takıldı' : waitText(one.waitingMs), isError)
  })
  leaving.slice(0, AT_DOOR).forEach((one, i) => {
    const x = DOOR_X + 7 - i * 14
    room += sprite(x, 208, one.look, 'idle', one.badge)
    tags += nameTag(x + 8, 245, one.name)
    tags += bubble(x + 8, 208, 'çıkıyor', false)
  })
  const hidden = sitting.length - shown.length + Math.max(0, leaving.length - AT_DOOR)
  if (hidden > 0) tags += label(248, 245, `+${hidden} bekliyor`, 5, '#e8dcc0')
  if (waiting.length === 0) room += label(112, 231, 'kimse beklemiyor', 5.5, '#9aa6b2')

  return { room, tags }
}

export function officeSvg(teams: Team[], usage: Usage | null, now: number, cache: CacheGauge | null = null): string {
  type Placed = { worker: Worker; name: string; at: Point; look: Look; slot: number; badge: string | null }
  const placed: Placed[] = []
  const waiting: Waiting[] = []
  const used: Record<Station, number> = { desk: 0, shelf: 0, terminal: 0, web: 0, board: 0, coffee: 0 }
  let lookIndex = 0
  for (const team of teams) {
    for (const worker of team.workers) {
      const isMain = worker.id === 'main'
      const look = isMain && team.isSelf ? MAIN_LOOK : (LOOKS[lookIndex++ % LOOKS.length] ?? MAIN_LOOK)
      // A chat with nobody at work waits in the waiting room: its chief alone.
      if (team.waitingMs !== null) {
        if (isMain) waiting.push({ worker, name: shownName(team, worker), look, badge: team.color, waitingMs: team.waitingMs })
        continue
      }
      // A helper that finished waits at the coffee corner.
      const station: Station = worker.status === 'working' ? worker.station : 'coffee'
      const slots = SLOTS[station]
      const n = used[station]++
      const base = slots[n % slots.length] ?? { x: 0, y: 0 }
      const shift = Math.floor(n / slots.length) * 5
      placed.push({
        worker,
        name: shownName(team, worker),
        look,
        badge: team.color,
        slot: station === 'desk' ? n % slots.length : -1,
        at: { x: base.x + shift, y: base.y + shift },
      })
    }
  }

  const busyDesks = [false, false, false]
  for (const one of placed) if (one.slot >= 0) busyDesks[one.slot] = true

  const draw = (one: Placed): string => {
    const cls = one.worker.status === 'working' ? 'work' : one.worker.status === 'done' ? 'idle done' : 'idle'

    return sprite(one.at.x, one.at.y, one.look, cls, one.badge)
  }
  const byDepth = (a: Placed, b: Placed): number => a.at.y - b.at.y

  const seated = placed.filter(one => one.slot >= 0).sort(byDepth)
  const standing = placed.filter(one => one.slot < 0).sort(byDepth)

  let tags = ''
  for (const one of placed) {
    const cx = one.at.x + 8
    tags += nameTag(cx, one.slot >= 0 ? 131 : one.at.y + 30, one.name)
    tags += bubble(cx, one.at.y, bubbleText(one.worker), one.worker.status === 'error')
  }
  const lobby = lounge(waiting)

  const active = placed.filter(one => one.worker.status === 'working').length

  return (
    `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${W} ${H}" width="${W * 2}" height="${H * 2}" shape-rendering="crispEdges">` +
    STYLE +
    room(teams, cache) +
    seated.map(draw).join('') +
    desks(busyDesks) +
    standing.map(draw).join('') +
    lobby.room +
    tags +
    lobby.tags +
    hud(usage, now, active, waiting.length, cache) +
    '</svg>'
  )
}

export function officeAlt(teams: Team[], usage: Usage | null, cache: CacheGauge | null = null): string {
  const working = teams
    .filter(team => team.waitingMs === null)
    .flatMap(team => team.workers.map(worker => `${shownName(team, worker)}: ${bubbleText(worker)}`))
  const waiting = teams.flatMap(team =>
    team.waitingMs === null
      ? []
      : team.workers.filter(worker => worker.id === 'main').map(worker => `${shownName(team, worker)} (${waitText(team.waitingMs ?? 0)})`),
  )
  const limits = (usage?.limits ?? []).map(limit => `${LIMIT_NAMES[limit.kind] ?? limit.kind} %${limit.percentUsed}`).join(', ')
  const warm = cache ? ` Önbellek: ${cache.text}${cache.hit === null ? '' : `, isabet %${cache.hit}`}.` : ''
  const work = working.length > 0 ? ` Çalışan: ${working.join(', ')}.` : ' Çalışan yok.'
  const wait = waiting.length > 0 ? ` Bekleme odası: ${waiting.join(', ')}.` : ''

  return `Piksel ofis.${work}${wait}${limits ? ` Limitler: ${limits}.` : ''}${warm}`
}
