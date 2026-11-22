import { expect, mock, test } from 'claude-code/testing'
import type { On } from 'claude-code'
import type { TestBody } from 'claude-code/testing'

const PANE = {
  plugin: 'pixel-ofis',
  component: 'Pane',
  requestId: 'pixel-ofis',
  props: {
    title: 'Piksel Ofis',
    isFocused: false,
    bodyColumns: 60,
    placement: 'dock',
    scroll: { offset: 0, bodyRows: 40 },
    view: {},
  },
} as const

const NOW = Date.parse('2026-11-03T12:00:00Z')
const bytes = new TextEncoder()
const TEMP_DIR = 'C:\\Users\\demo\\AppData\\Local\\Temp'
// Where Claude Code writes this session's background output.
const TASKS = `${TEMP_DIR}\\claude\\h1\\me\\tasks`
const MINUTE = 60 * 1000
const HOME = 'C:\\Users\\demo'
const LIVE = `${HOME}/.claude/pixel-ofis-live`
// Where Claude Code keeps this session's transcript: the project folder named after the path.
const TRANSCRIPT = `${HOME}/.claude/projects/C--work-demo-app/me.jsonl`

const USAGE = {
  startedAt: 0,
  context: { tokens: 62000, window: 200000, percent: 31 },
  rateLimits: [
    { kind: 'five_hour', percentUsed: 42, resetsAt: '2026-11-03T14:00:00Z' },
    { kind: 'seven_day', percentUsed: 88 },
  ],
  cost: { usd: 1.25 },
}

const SPAWN = {
  tool_use_id: 'tu1',
  provider: { plugin: 'core', tier: 'core' },
  parentModel: 'opus',
  background: false,
  fork: false,
} as const

const chief = (task: string, tool: string | null, startedAt = 0) => ({
  id: 'main',
  name: 'Şef',
  role: 'ana oturum',
  status: tool ? 'working' : 'idle',
  station: tool ? 'desk' : 'coffee',
  tool,
  task,
  tools: 1,
  startedAt,
})

// The engine hands the hooks a path in the platform's spelling: the disk below does too.
const norm = (path: string): string => path.replace(/\//g, '\\')

const SUMMARY = { role: 'user' as const, text: 'özet', toolUses: [] }

// What a refused call says: the reason, as the deny or as the errored result's text.
const said = (result: { deny?: string; text?: string }): string => result.deny ?? String(result.text)

const ANSWER = { answer: 'tamam', durationMs: 1000, isAborted: false, reason: 'answer' } as const

type World = {
  usage?: { tokens: number; window: number; percent: number }
  diff?: string
  // The mod's own manifest on disk: its version, which a test may change later.
  manifest?: { version: string }
  // The rate-limit windows this chat's last response reported.
  limits?: { kind: string; percentUsed: number; resetsAt?: string }[]
  // What a tool call answers, when not the empty record.
  tool?: (e: { tool: string } & Record<string, unknown>) => { result: unknown; text?: string } | undefined
  // The session's agents, as `$.agent.list()` answers them.
  agents?: { id: string; status: string }[]
}

// The engine beneath the plugin: a session, a disk in memory and the person's actions.
function world(on: On, files: Map<string, string> = new Map(), more: World = {}) {
  const toasts: string[] = []
  const notes: string[] = []
  const sends: string[] = []
  const compacts: string[] = []
  // The tools the plugin itself called, with their input.
  const calls: ({ tool: string } & Record<string, unknown>)[] = []
  for (const [path, text] of [...files]) {
    files.delete(path)
    files.set(norm(path), text)
  }
  const clock = mock.clock(on, { now: NOW })
  mock.env(on, { USERPROFILE: HOME, TEMP: TEMP_DIR })
  mock.store(on)
  on('command.register', () => ({ value: { command: 'ofis' } }))
  on('ui.open', () => ({ value: { isPlaced: true } }))
  on('ui.toast', (_, e) => {
    toasts.push(e.text)

    return { value: undefined }
  })
  on('ui.log', () => ({ value: undefined }))
  const usage = { ...USAGE, context: more.usage ?? USAGE.context, rateLimits: more.limits ?? USAGE.rateLimits }
  on('session.usage', () => ({ value: usage as never }))
  on('session.id', () => ({ value: 'me' }))
  on('session.cwd', () => ({ value: 'C:\\work\\demo-app' }))
  on('session.start', (_, e) => ({ cwd: e.cwd }))
  on('session.end', (_, e) => ({ sessionId: e.sessionId }))
  on('session.measure', (_, e) => ({ changed: e.changed }))
  on('session.compact', (_, e) => {
    compacts.push(e.instructions ?? '')

    return { messages: [SUMMARY] }
  })
  on('process.run', () => ({
    value: { exitCode: more.diff === undefined ? 128 : 0, stdout: more.diff ?? '', stderr: '', isStdoutTruncated: false, isStderrTruncated: false },
  }))
  on('turn.start', (_, e) => ({ turnId: e.turnId }))
  on('tool.call', (_, e, next) => {
    const input = e as unknown as { tool: string } & Record<string, unknown>
    if (next.origin.plugin === 'pixel-ofis') calls.push(input)

    return more.tool?.(input) ?? { result: {} }
  })
  on('agent.list', () => ({ value: (more.agents ?? []) as never }))
  on('ui.scroll', () => ({}))
  on('classic.Stop', () => ({}))
  on('agent.spawn', (_, e) => ({ model: 'sonnet', agentId: e.fork ? 'f1' : 'a1' }))
  on('turn.complete', (_, e) => ({ text: e.answer }))
  on('prompt.submit', (_, e) => {
    notes.push((e.context ?? []).join('\n'))

    return { text: e.text }
  })
  on('tool.register', (_, e) => ({ value: { tool: `mcp__pixel-ofis__${e.name}` } }))
  on('session.send', (_, e) => {
    sends.push(e.text)

    return { isDelivered: true }
  })
  on('fs.list', (_, e) => {
    const dir = e.path.replace(/\\/g, '/')
    const entries = [...files.keys()]
      .filter(path => path.replace(/\\/g, '/').startsWith(`${dir}/`))
      .map(path => ({ name: path.replace(/\\/g, '/').slice(dir.length + 1), kind: 'file' as const, size: 1, mtimeMs: NOW, isLink: false }))
    if (entries.length === 0) throw new Error('ENOENT')

    return { value: entries }
  })
  on('fs.exists', (_, e) => ({ value: files.has(norm(e.path)) || [...files.keys()].some(path => path.startsWith(`${norm(e.path)}\\`)) }))
  on('fs.stat', (_, e) => {
    const text = files.get(norm(e.path))
    if (text === undefined) throw new Error('ENOENT')

    return { value: { kind: 'file' as const, size: bytes.encode(text).length, mtimeMs: NOW - 4000, isLink: false } }
  })
  on('fs.read', (_, e) => {
    if (more.manifest && /[\\/]\.claude-plugin[\\/]plugin\.json$/.test(e.path)) return { value: JSON.stringify(more.manifest) }
    const text = files.get(norm(e.path))
    if (text === undefined) throw new Error('ENOENT')
    if (e.offset === undefined && e.length === undefined) return { value: text }
    const all = bytes.encode(text)
    const start = e.offset ?? 0

    return { value: new TextDecoder().decode(all.slice(start, e.length === undefined ? undefined : start + e.length)) }
  })
  on('fs.write', (_, e) => {
    files.set(norm(e.path), e.text)

    return { value: undefined }
  })

  return { clock, files, toasts, notes, sends, compacts, calls }
}

async function office($: Parameters<TestBody>[0]) {
  const ui = await $.ui.mount({ ...PANE, surface: 'vscode' })
  const svg = await ui.find({ type: 'Svg' })
  const found = { alt: String(svg?.props.alt), source: String(svg?.props.source), ui }

  return found
}

test('workers move to the station of their tool; the pane is the drawing alone', async ($, on) => {
  world(on)

  await $.session.start({ cwd: '/', surface: 'vscode', isInteractive: true })
  await $.turn.start({ text: 'testleri koş', turnId: 't1' })
  await $.tool.call({ tool: 'Bash', command: 'ls' })
  await $.agent.spawn({ ...SPAWN, prompt: 'dosyaları bul', description: 'dosya ara', subagentType: 'Explore' })
  await $.tool.call({ tool: 'Grep', pattern: 'x', agentId: 'a1' })

  const { alt, source, ui } = await office($)
  // Before Claude Code titles the chat, its chief carries the first task.
  expect(alt).toContain('Çalışan: testleri koş: Bash, Kaşif: Grep')
  expect(alt).toContain('5 SAAT %42')
  expect(source.startsWith('<svg')).toBe(true)
  expect(source.length).toBeLessThan(131072)
  expect(source).toContain('%88')
  expect(source).toContain('$1.25')
  expect(source).toContain('GÖREVLER')
  expect(source).toContain('BEKLEME ODASI')
  expect(source).toContain('kimse beklemiyor')
  // No board, name, task or attachment fields under the drawing any more.
  expect(await ui.find({ type: 'Input' })).toBeUndefined()
  expect(await ui.find({ type: 'Text' })).toBeUndefined()
  await ui.unmount()

  await $.turn.complete({ ...ANSWER, turnId: 't2', agentId: 'a1' })
  const after = await office($)
  expect(after.alt).toContain('Kaşif: bitti')
  await after.ui.unmount()
})

test('a chat that finished waits in the waiting room, its own pane never shows it leave', async ($, on) => {
  const { clock } = world(on)
  await $.session.start({ cwd: '/', surface: 'vscode', isInteractive: true })
  await $.turn.start({ text: 'raporu yaz', turnId: 't1' })
  await $.turn.complete({ ...ANSWER, turnId: 't1' })

  const first = await office($)
  expect(first.alt).toContain('Çalışan yok.')
  expect(first.alt).toContain('Bekleme odası: raporu yaz (az önce)')
  expect(first.source).toContain('BEKLEYEN: 1')
  await first.ui.unmount()

  await clock.advance(12 * MINUTE)
  const later = await office($)
  expect(later.alt).toContain('raporu yaz (12 dk)')
  await later.ui.unmount()

  await clock.advance(40 * MINUTE)
  const long = await office($)
  expect(long.alt).toContain('Bekleme odası: raporu yaz (çıkıyor)')
  await long.ui.unmount()

  // A new task brings it back to the office.
  await $.turn.start({ text: 'devam', turnId: 't2' })
  const back = await office($)
  expect(back.alt).toContain('Çalışan: raporu yaz: düşünüyor…')
  expect(back.alt).not.toContain('Bekleme odası')
  await back.ui.unmount()
})

const peer = (sessionId: string, title: string, activeAt: number | undefined, updatedAt: number, tool: string | null = null) =>
  JSON.stringify({
    sessionId,
    project: 'demo-app',
    task: title,
    name: title,
    purpose: title,
    tasks: [title],
    files: [],
    workers: [chief(title, tool, NOW - 60 * MINUTE)],
    ...(activeAt === undefined ? {} : { activeAt }),
    updatedAt,
  })

test('other chats wait their thirty minutes, stand at the door, then leave the office', async ($, on) => {
  const files = new Map([
    [`${LIVE}/slot-0.json`, peer('busy', 'Arama ekranı', NOW - 50 * MINUTE, NOW - 2000, 'Edit')],
    [`${LIVE}/slot-2.json`, peer('rest', 'Giriş hatası', NOW - 10 * MINUTE, NOW - 2000)],
    [`${LIVE}/slot-3.json`, peer('door', 'Kayıt formu', NOW - 28 * MINUTE, NOW - 2000)],
    [`${LIVE}/slot-4.json`, peer('gone', 'Eski iş', NOW - 31 * MINUTE, NOW - 2000)],
    // An older version's chat, never active: no time to wait from.
    [`${LIVE}/slot-5.json`, JSON.stringify({ sessionId: 'blank', project: 'demo-app', task: '', workers: [chief('', null)], updatedAt: NOW - 2000 })],
  ])
  const { clock } = world(on, files)
  await $.session.start({ cwd: '/', surface: 'vscode', isInteractive: true })
  await $.turn.start({ text: 'testleri koş', turnId: 't1' })
  await clock.advance(3000)

  // This chat wrote itself to the first free slot, with the time it was last active.
  const own = JSON.parse(files.get(norm(`${LIVE}/slot-1.json`)) ?? '{}')
  expect(own.sessionId).toBe('me')
  expect(own.activeAt).toBe(NOW)

  const now = await office($)
  // A chat at work stays however long ago its turn began; its chief wears its title.
  expect(now.alt).toContain('Arama ekranı: Edit')
  expect(now.alt).toContain('Giriş hatası (10 dk)')
  expect(now.alt).toContain('Kayıt formu (çıkıyor)')
  expect(now.alt).not.toContain('Eski iş')
  expect(now.alt).not.toContain('Şef')
  await now.ui.unmount()

  // Twenty-one minutes on, every chat still open: the waiting one has left too.
  await clock.advance(21 * MINUTE)
  const at = clock.now()
  files.set(norm(`${LIVE}/slot-0.json`), peer('busy', 'Arama ekranı', NOW - 50 * MINUTE, at, 'Edit'))
  files.set(norm(`${LIVE}/slot-2.json`), peer('rest', 'Giriş hatası', NOW - 10 * MINUTE, at))
  await clock.advance(3000)
  const later = await office($)
  expect(later.alt).toContain('Arama ekranı: Edit')
  expect(later.alt).not.toContain('Giriş hatası')
  await later.ui.unmount()

  // Asked again, it walks back in.
  files.set(norm(`${LIVE}/slot-2.json`), peer('rest', 'Giriş hatası', clock.now(), clock.now(), 'Read'))
  await clock.advance(3000)
  const back = await office($)
  expect(back.alt).toContain('Giriş hatası: Read')
  await back.ui.unmount()

  await $.session.end({ reason: 'prompt_input_exit', sessionId: 'me', resume: { sessionId: 'me' } as never })
  expect(JSON.parse(files.get(norm(`${LIVE}/slot-1.json`)) ?? '{}').ended).toBe(true)
})

test('the chat is named by the title Claude Code gave the session, the person’s own first', async ($, on) => {
  const rows = [
    { type: 'user', message: { content: 'bir şey "type":"ai-title" yazan mesaj' } },
    { type: 'ai-title', aiTitle: 'İlk başlık', sessionId: 'me' },
    { type: 'assistant', message: { content: 'tamam' } },
    { type: 'ai-title', aiTitle: 'Piksel ofis bekleme odası', sessionId: 'me' },
  ]
  const files = new Map([[TRANSCRIPT, rows.map(row => JSON.stringify(row)).join('\n')]])
  const { clock } = world(on, files)
  await $.session.start({ cwd: '/', surface: 'vscode', isInteractive: true })
  await $.turn.start({ text: 'pano ekle', turnId: 't1' })
  await $.turn.complete({ ...ANSWER, turnId: 't1' })
  await clock.advance(3000)

  expect(JSON.parse(files.get(norm(`${LIVE}/journal/me.json`)) ?? '{}').name).toBe('Piksel ofis bekleme odası')
  const titled = await office($)
  // Shortened to fit under the figure.
  expect(titled.alt).toContain('Bekleme odası: Piksel ofis b… (az önce)')
  await titled.ui.unmount()

  // The person renamed it: that title wins over any generated later.
  const renamed = [...rows, { type: 'custom-title', customTitle: 'Ofis', sessionId: 'me' }, { type: 'ai-title', aiTitle: 'Başka', sessionId: 'me' }]
  files.set(norm(TRANSCRIPT), renamed.map(row => JSON.stringify(row)).join('\n'))
  await $.turn.start({ text: 'devam', turnId: 't2' })
  await $.turn.complete({ ...ANSWER, turnId: 't2' })
  expect(JSON.parse(files.get(norm(`${LIVE}/journal/me.json`)) ?? '{}').name).toBe('Ofis')
})

test('a newer version on disk is told in the pane, with how to take it in', async ($, on) => {
  const manifest = { version: '0.4.0' }
  const { clock } = world(on, new Map(), { manifest })
  await $.session.start({ cwd: '/', surface: 'vscode', isInteractive: true })
  await clock.advance(30000)
  const same = await $.ui.mount({ ...PANE, surface: 'vscode' })
  expect(await same.find({ type: 'Text' })).toBeUndefined()
  await same.unmount()

  manifest.version = '0.5.0'
  await clock.advance(30000)
  const ui = await $.ui.mount({ ...PANE, surface: 'vscode' })
  const told = (await ui.find({ type: 'Text', text: /hazır/ }))?.text ?? ''
  expect(told).toContain('Piksel Ofis 0.5.0 hazır, bu sohbet hâlâ 0.4.0 sürümünde')
  expect(told).toContain('geçmişten yeniden aç')
  await ui.unmount()
})

test('the board keeps what this chat is for and the files it changed', async ($, on) => {
  const { clock, files } = world(on)
  await $.session.start({ cwd: '/', surface: 'vscode', isInteractive: true })
  await $.turn.start({ text: 'pano ekle\nayrıntı', turnId: 't1' })
  await $.tool.call({ tool: 'Edit', file_path: SRC, old_string: 'a', new_string: 'b' })
  await clock.advance(3000)

  const journal = JSON.parse(files.get(norm(`${LIVE}/journal/me.json`)) ?? '{}')
  expect(journal.purpose).toBe('pano ekle')
  expect(journal.label).toBe('#1')
  expect(journal.files[0].path).toBe(SRC)
})

test('a resumed chat finds its name and purpose again', async ($, on) => {
  const before = JSON.stringify({ sessionId: 'me', label: '#4', project: 'demo-app', name: 'Eski ad', purpose: 'eski amaç', tasks: [], files: [], startedAt: 1, updatedAt: NOW - 1000 })
  world(on, new Map([[`${LIVE}/journal/me.json`, before]]))
  await $.session.start({ cwd: '/', surface: 'vscode', isInteractive: true })

  const { alt, ui } = await office($)
  expect(alt).toContain('Eski ad')
  await ui.unmount()
})

const SRC = 'C:\\work\\demo-app\\src\\a.py'
const OTHER = (files: { path: string; at: number; tool: string }[], updatedAt = NOW - 2000) =>
  JSON.stringify({
    sessionId: 'other',
    project: 'demo-app',
    task: 'arama ekranı',
    name: 'Arama',
    purpose: 'arama ekranı',
    tasks: ['arama ekranı'],
    files,
    workers: [chief('arama ekranı', 'Edit')],
    activeAt: NOW - 2000,
    updatedAt,
  })

test("another chat's recent file is not overwritten blind, and an edit of it is flagged", async ($, on) => {
  const files = new Map([[`${LIVE}/slot-0.json`, OTHER([{ path: SRC, at: NOW - 60000, tool: 'Edit' }])]])
  const { clock } = world(on, files)
  await $.session.start({ cwd: '/', surface: 'vscode', isInteractive: true })
  await clock.advance(3000)

  // The same file spelled with other slashes and case is still the same file.
  const spelled = 'c:/work/demo-app/src/a.py'
  const held = await $.tool.call({ tool: 'Write', file_path: spelled, content: 'x' })
  expect(JSON.stringify(held)).toContain('#1 \\"Arama\\"')
  expect(JSON.stringify(held)).toContain('Read ile oku')
  // Once warned, the next write goes through.
  const again = await $.tool.call({ tool: 'Write', file_path: spelled, content: 'x' })
  expect(again.isError).toBeUndefined()
  expect((again.context ?? []).join('\n')).toContain('bu dosyayı başka sohbet de değiştirdi')

  // Repeated within ten minutes it stays quiet: the note costs tokens.
  const edited = await $.tool.call({ tool: 'Edit', file_path: SRC, old_string: 'a', new_string: 'b' })
  expect(edited.context ?? []).toEqual([])
  // Ten minutes on, the other chat still at work.
  await clock.advance(10 * 60 * 1000)
  files.set(norm(`${LIVE}/slot-0.json`), OTHER([{ path: SRC, at: NOW - 60000, tool: 'Edit' }], clock.now()))
  await clock.advance(3000)
  const later = await $.tool.call({ tool: 'Edit', file_path: SRC, old_string: 'b', new_string: 'c' })
  expect((later.context ?? []).join('\n')).toContain('#1 "Arama"')

  // A file nobody else touched raises nothing.
  const free = await $.tool.call({ tool: 'Write', file_path: 'C:\\work\\demo-app\\src\\b.py', content: 'x' })
  expect(free.isError).toBeUndefined()
})

const OWN = 'C:\\work\\demo-app\\src\\own.py'
const edit = (file_path: string) => ({ tool: 'Edit' as const, file_path, old_string: 'a', new_string: 'b' })

test('the model reads the board when it first changes a file, again only when it changed', async ($, on) => {
  const files = new Map([[`${LIVE}/slot-0.json`, OTHER([{ path: SRC, at: NOW - 60000, tool: 'Edit' }])]])
  const { clock, notes } = world(on, files)
  await $.session.start({ cwd: '/', surface: 'vscode', isInteractive: true })
  await clock.advance(3000)

  // A prompt alone carries nothing: a turn that only reads or talks is not charged.
  await $.prompt.submit({ text: 'bir iş', wait: false, origin: { kind: 'user' } as never })
  expect(notes[0]).toBe('')

  const first = ((await $.tool.call(edit(OWN))).context ?? []).join('\n')
  expect(first).toContain('[Piksel Ofis panosu')
  expect(first).toContain('#1 "Arama" (çalışıyor)')
  expect(first).toContain('Değiştirdiği dosyalar: src/a.py')
  expect(first).toContain('mcp__pixel-ofis__ofis_mesaj')

  // The board as it was: nothing again.
  expect((await $.tool.call(edit(OWN))).context ?? []).toEqual([])

  // The board changed: told again, without the how-to said once already.
  files.set(norm(`${LIVE}/slot-0.json`), OTHER([{ path: 'C:\\work\\demo-app\\src\\c.py', at: NOW, tool: 'Write' }, { path: SRC, at: NOW - 60000, tool: 'Edit' }]))
  await clock.advance(3000)
  const third = ((await $.tool.call(edit(OWN))).context ?? []).join('\n')
  expect(third).toContain('src/c.py, src/a.py')
  expect(third).not.toContain('mcp__pixel-ofis__ofis_mesaj')

  // A subagent's edit tells the main conversation nothing.
  files.set(norm(`${LIVE}/slot-0.json`), OTHER([{ path: 'C:\\work\\demo-app\\src\\d.py', at: NOW, tool: 'Write' }]))
  await clock.advance(3000)
  expect((await $.tool.call({ ...edit(OWN), agentId: 'a1' })).context ?? []).toEqual([])
})

test('a held Write shows the uncommitted changes and asks for an Edit instead', async ($, on) => {
  const files = new Map([[`${LIVE}/slot-0.json`, OTHER([{ path: SRC, at: NOW - 60000, tool: 'Edit' }])]])
  const diff = 'diff --git a/src/a.py b/src/a.py\nindex 1..2 100644\n--- a/src/a.py\n+++ b/src/a.py\n@@ -1 +1 @@\n-eski\n+onların satırı\n'
  const { clock } = world(on, files, { diff })
  await $.session.start({ cwd: '/', surface: 'vscode', isInteractive: true })
  await clock.advance(3000)

  const held = await $.tool.call({ tool: 'Write', file_path: SRC, content: 'x' })
  const text = said(held)
  expect(text).toContain('```diff\n@@ -1 +1 @@\n-eski\n+onların satırı')
  expect(text).not.toContain('index 1..2')
  expect(text).toContain('Edit ile yalnız kendi değiştireceğin yeri')
})

const LIMITS = `${LIVE}/limits.json`
const FIVE_RESET = '2026-11-03T14:00:00Z'
const readings = (files: Map<string, string>) =>
  (JSON.parse(files.get(norm(LIMITS)) ?? '{"readings":[]}') as { readings: { kind: string; percentUsed: number }[] }).readings

test("the limits are the account's: an idle chat shows what the other chats spent", async ($, on) => {
  const files = new Map([[LIMITS, JSON.stringify({ readings: [{ kind: 'five_hour', percentUsed: 30, resetsAt: FIVE_RESET }] })]])
  const { clock } = world(on, files)
  await $.session.start({ cwd: '/', surface: 'vscode', isInteractive: true })

  // This chat's own 42 is later than the file's 30 in the same window: it is written there.
  const first = await office($)
  expect(first.alt).toContain('5 SAAT %42')
  await first.ui.unmount()
  expect(readings(files).find(one => one.kind === 'five_hour')?.percentUsed).toBe(42)
  expect(readings(files).find(one => one.kind === 'seven_day')?.percentUsed).toBe(88)

  // Another chat spends on while this one idles: its response's reading reaches this pane.
  files.set(
    norm(LIMITS),
    JSON.stringify({
      readings: [
        { kind: 'five_hour', percentUsed: 71, resetsAt: FIVE_RESET },
        { kind: 'seven_day', percentUsed: 91, resetsAt: null },
      ],
    }),
  )
  await clock.advance(15000)
  const idle = await office($)
  expect(idle.alt).toContain('5 SAAT %71')
  expect(idle.alt).toContain('7 GÜN %91')
  await idle.ui.unmount()

  // An older chat writes its stale reading over the file: this chat writes the later one back.
  files.set(norm(LIMITS), JSON.stringify({ readings: [{ kind: 'five_hour', percentUsed: 50, resetsAt: FIVE_RESET }] }))
  await clock.advance(15000)
  expect(readings(files).find(one => one.kind === 'five_hour')?.percentUsed).toBe(71)
})

test('a new window wins over a fuller old one, and a window past its reset shows empty', async ($, on) => {
  const old = { kind: 'five_hour', percentUsed: 97, resetsAt: '2026-11-03T09:00:00Z' }
  const files = new Map([[LIMITS, JSON.stringify({ readings: [old] })]])
  const soon = '2026-11-03T12:20:00Z'
  const { clock } = world(on, files, { limits: [{ kind: 'five_hour', percentUsed: 42, resetsAt: soon }] })
  await $.session.start({ cwd: '/', surface: 'vscode', isInteractive: true })

  // The file's 97 belongs to a window that reset at nine: this chat's 42 is the live one.
  const first = await office($)
  expect(first.alt).toContain('5 SAAT %42')
  await first.ui.unmount()

  // A response reports a higher figure of the same window: the pane and the file follow it.
  await $.session.measure({
    context: USAGE.context,
    rateLimits: [{ kind: 'five_hour', percentUsed: 64, resetsAt: soon }],
    cost: USAGE.cost,
    changed: ['rateLimits'],
  })
  expect(readings(files).find(one => one.kind === 'five_hour')?.percentUsed).toBe(64)

  // Past its reset with no response since: the five-hour window has started over.
  await clock.advance(21 * MINUTE)
  const after = await office($)
  expect(after.alt).toContain('5 SAAT %0')
  await after.ui.unmount()
})

test('the HUD shows the cache hit, and how warm the cache is', async ($, on) => {
  const { clock } = world(on)
  await $.session.start({ cwd: '/', surface: 'vscode', isInteractive: true })
  await $.turn.start({ text: 'oku', turnId: 't1' })
  const usage = { input_tokens: 500, output_tokens: 1200, cache_read_input_tokens: 57000, cache_creation_input_tokens: 2500 }
  await $.turn.complete({ ...ANSWER, turnId: 't1', usage: { ...usage, model: 'opus' } as never })

  const first = await office($)
  expect(first.source).toContain('İSABET %95')
  expect(first.alt).toContain('Önbellek: sıcak, 0 dk, isabet %95')
  await first.ui.unmount()

  // Twenty minutes on, the cache past its short lifetime: the HUD says it may be cold.
  await clock.advance(20 * MINUTE)
  const later = await office($)
  expect(later.alt).toContain("ılık, 20 dk (5 dk'lık önbellekte soğudu)")
  await later.ui.unmount()

  // The next turn read its prefix back after the pause: the cache lives an hour.
  await $.turn.start({ text: 'devam', turnId: 't2' })
  const back = { input_tokens: 300, output_tokens: 100, cache_read_input_tokens: 61000, cache_creation_input_tokens: 800 }
  await $.turn.complete({ ...ANSWER, turnId: 't2', usage: { ...back, model: 'opus' } as never })
  const learned = await office($)
  expect(learned.alt).toContain('sıcak, 0 dk (1 sa)')
  await learned.ui.unmount()
})

test('a full context offers a compaction the board steers, and every compaction is told', async ($, on) => {
  const { compacts, toasts } = world(on, new Map(), { usage: { tokens: 150000, window: 200000, percent: 75 } })
  await $.session.start({ cwd: '/', surface: 'vscode', isInteractive: true })
  await $.turn.start({ text: 'grafik ekranını yap', turnId: 't1' })
  await $.tool.call(edit(OWN))
  const usage = { input_tokens: 1, output_tokens: 1, cache_read_input_tokens: 1, cache_creation_input_tokens: 1 }
  await $.turn.complete({ ...ANSWER, turnId: 't1', usage: { ...usage, model: 'opus' } as never })
  expect(toasts.at(-1)).toContain('Bağlam %75')

  const ui = await $.ui.mount({ ...PANE, surface: 'vscode' })
  await ui.press({ key: 'sikistir' })
  expect(compacts[0]).toContain('Amacı: grafik ekranını yap')
  expect(compacts[0]).toContain('Değiştirdiği dosyalar: src/own.py')
  // Said once: the plugin's own hook leaves the pane's instructions as they are.
  expect(compacts[0]?.split('Piksel Ofis panosuna göre').length).toBe(2)
  expect(toasts.at(-1)).toBe('Sohbet pano özetiyle sıkıştırıldı.')
  await ui.unmount()

  // A compaction the plugin did not start keeps its own instructions and gets the board's.
  await $.session.compact({ trigger: 'manual', messages: [SUMMARY], instructions: 'testleri unutma' })
  expect(compacts[1]).toContain('testleri unutma\n\nPiksel Ofis panosuna göre bu sohbet:')
})

test('a quiet context offers no compaction', async ($, on) => {
  world(on)
  await $.session.start({ cwd: '/', surface: 'vscode', isInteractive: true })
  const ui = await $.ui.mount({ ...PANE, surface: 'vscode' })
  expect(await ui.find({ key: 'sikistir' })).toBeUndefined()
  await ui.unmount()
})

const FINDING = {
  id: 'other:a9',
  sessionId: 'other',
  label: '#1',
  project: 'demo-app',
  type: 'Explore',
  description: 'arama ekranının veri akışını bul',
  prompt: 'Arama ekranında sorgu kutusundan sonuç listesine veri akışını bul; hangi servis çağrılıyor, sonuçlar nerede süzülüyor',
  summary: 'Sorgu SearchBox içinde debounce edilir, searchService.query çağrılır, sonuçlar ResultList içinde süzülür.',
  at: NOW - 10 * 60 * 1000,
}

test("another chat's research is offered once before a subagent repeats it", async ($, on) => {
  const files = new Map([[`${LIVE}/findings/other.json`, JSON.stringify([FINDING])]])
  const { clock } = world(on, files)
  await $.session.start({ cwd: '/', surface: 'vscode', isInteractive: true })
  await clock.advance(3000)

  const brief = {
    tool: 'Agent' as const,
    description: 'arama veri akışı',
    prompt: 'Arama ekranında sorgu kutusundan sonuç listesine giden veri akışını bul; hangi servis çağrılıyor ve sonuçlar nerede süzülüyor?',
    subagent_type: 'Explore',
  }
  const held = said(await $.tool.call(brief))
  expect(held).toContain('#1 bu soruyu 10 dk önce bir alt ajana (Explore) araştırttı')
  expect(held).toContain('searchService.query')
  // Asked again, the subagent starts.
  expect((await $.tool.call(brief)).isError).toBeUndefined()
  // A different question starts at once.
  const other = { ...brief, description: 'giriş hatası', prompt: 'Giriş formunda parola alanı boşken neden hata kutusu iki kez açılıyor, kaynağını bul ve raporla' }
  expect((await $.tool.call(other)).isError).toBeUndefined()
})

test("a subagent's report is kept for the other chats; a fork's is not", async ($, on) => {
  const { files } = world(on)
  await $.session.start({ cwd: '/', surface: 'vscode', isInteractive: true })
  await $.agent.spawn({ ...SPAWN, prompt: 'ödeme akışını bul ve anlat', description: 'ödeme akışı', subagentType: 'Explore' })
  const report = `Ödeme akışı: ${'ayrıntı '.repeat(60)}`
  await $.turn.complete({ ...ANSWER, answer: report, durationMs: 4000, turnId: 't2', agentId: 'a1' })

  const kept = JSON.parse(files.get(norm(`${LIVE}/findings/me.json`)) ?? '[]')
  expect(kept.length).toBe(1)
  expect(kept[0].description).toBe('ödeme akışı')
  expect(kept[0].type).toBe('Explore')
  expect(kept[0].summary.startsWith('Ödeme akışı:')).toBe(true)
  expect(kept[0].project).toBe('demo-app')

  await $.agent.spawn({ ...SPAWN, fork: true, prompt: 'devam et', description: 'ikiz', subagentType: 'fork' })
  await $.turn.complete({ ...ANSWER, answer: report, durationMs: 4000, turnId: 't3', agentId: 'f1' })
  expect(JSON.parse(files.get(norm(`${LIVE}/findings/me.json`)) ?? '[]').length).toBe(1)
})

test('a chat with nobody else around adds nothing to the prompt', async ($, on) => {
  const { notes } = world(on)
  await $.session.start({ cwd: '/', surface: 'vscode', isInteractive: true })
  await $.prompt.submit({ text: 'tek başına', wait: false, origin: { kind: 'user' } as never })
  expect(notes).toEqual([''])
})

test('ofis_mesaj sends to a chat by its board number or name', async ($, on) => {
  const files = new Map([[`${LIVE}/slot-0.json`, OTHER([])]])
  const { clock, sends } = world(on, files)
  on('tool.call', { tool: 'mcp__pixel-ofis__ofis_mesaj' }, () => ({ result: 'test beneath' }))
  await $.session.start({ cwd: '/', surface: 'vscode', isInteractive: true })
  await clock.advance(3000)

  const byNumber = await $.tool.call({ tool: 'mcp__pixel-ofis__ofis_mesaj', to: '1', text: 'a.py değişti' })
  expect(String(byNumber.result)).toContain('#1 "Arama" sohbetine iletildi')
  const byName = await $.tool.call({ tool: 'mcp__pixel-ofis__ofis_mesaj', to: 'arama', text: 'tamam' })
  expect(String(byName.result)).toContain('iletildi')
  expect(sends).toEqual(['a.py değişti', 'tamam'])

  const nobody = await $.tool.call({ tool: 'mcp__pixel-ofis__ofis_mesaj', to: '#7', text: 'x' })
  expect(String(nobody.result)).toContain('Böyle bir sohbet şu an çalışmıyor')
})

test('ended chats of the last day still guard the files they changed', async ($, on) => {
  const past = JSON.stringify({
    sessionId: 'gone',
    label: '#3',
    project: 'demo-app',
    name: '',
    purpose: 'girişi düzelt',
    tasks: [],
    files: [{ path: 'C:\\work\\demo-app\\src\\login.py', at: NOW - 600000, tool: 'Edit' }],
    startedAt: 1,
    updatedAt: NOW - 600000,
    ended: true,
  })
  const { clock, notes } = world(on, new Map([[`${LIVE}/journal/gone.json`, past]]))
  await $.session.start({ cwd: '/', surface: 'vscode', isInteractive: true })
  // The first look at the journal folder runs beside the session's start.
  await clock.advance(3000)

  await $.prompt.submit({ text: 'iş', wait: false, origin: { kind: 'user' } as never })
  expect(notes[0]).toBe('')
  const told = ((await $.tool.call(edit(OWN))).context ?? []).join('\n')
  expect(told).toContain('#3 "girişi düzelt" (kapandı)')

  const held = await $.tool.call({ tool: 'Write', file_path: 'C:\\work\\demo-app\\src\\login.py', content: 'x' })
  expect(JSON.stringify(held)).toContain('#3')
})

test('the terminal, which has no Svg, gets the office as text', async ($, on) => {
  mock.clock(on, { now: NOW })
  on('session.usage', () => ({ value: USAGE }))
  const ui = await $.ui.mount({ ...PANE, surface: 'terminal' })
  expect((await ui.find({ type: 'Text', text: /Piksel ofis/ }))?.text).toContain('Bekleme odası: Şef (az önce)')
  await ui.unmount()
})

// ---- Background jobs ----------------------------------------------------------------

const ESC = String.fromCharCode(27)

const bashInBackground = (id: string) => (e: { tool: string } & Record<string, unknown>) =>
  e.tool === 'Bash' && e.run_in_background
    ? {
        result: { stdout: '', stderr: '', interrupted: false, backgroundTaskId: id },
        text: `Command running in background with ID: ${id}. Output is being written to: ${TASKS}\\${id}.output. You will be notified when it completes.`,
      }
    : undefined

const jobButton = async (ui: Awaited<ReturnType<typeof office>>['ui'], key: string) => (await ui.find({ key: `is-${key}` }))?.text ?? ''

test('a background command is listed under the office; its output opens in its place and the office comes back', { timeoutMs: 15000 }, async ($, on) => {
  const files = new Map([[`${TASKS}\\b1.output`, `${ESC}[32mPASSED${ESC}[0m test_giris\r\n10%\r50%\r100%\nbitti\n`]])
  world(on, files, { tool: bashInBackground('b1') })
  await $.session.start({ cwd: '/', surface: 'vscode', isInteractive: true })
  await $.turn.start({ text: 'testleri koş', turnId: 't1' })
  await $.tool.call({ tool: 'Bash', command: 'python -m pytest tests/ui -q', description: 'UI testleri', run_in_background: true })

  const { ui } = await office($)
  expect(String((await ui.find({ type: 'Text' }))?.text)).toContain('Arka plan işleri · 1 çalışıyor')
  expect(await jobButton(ui, 'me:b1')).toContain('#1 UI testleri')
  expect(await jobButton(ui, 'me:b1')).toContain('çalışıyor · 0 sn')
  await ui.press({ key: 'is-me:b1' })

  // The office makes room for the job: its output, cleaned of colour codes and of the
  // progress a line rewrote, and a way back.
  expect(await ui.find({ type: 'Svg' })).toBeUndefined()
  const output = String((await ui.find({ type: 'Code' }))?.props.source)
  expect(output).toBe('PASSED test_giris\n100%\nbitti\n')
  expect(await ui.find({ key: 'is-durdur' })).toBeDefined()
  expect(await ui.find({ type: 'Text', text: 'Komut: python -m pytest tests/ui -q' })).toBeDefined()
  await ui.press({ key: 'ofise-don-alt' })
  expect(await ui.find({ type: 'Svg' })).toBeDefined()
  await ui.unmount()
})

test('a long output reads page by page, the newest first', { timeoutMs: 15000 }, async ($, on) => {
  const lines = Array.from({ length: 12000 }, (_, at) => `satır ${String(at).padStart(5, '0')} ................`)
  const files = new Map([[`${TASKS}\\b1.output`, `${lines.join('\n')}\n`]])
  world(on, files, { tool: bashInBackground('b1') })
  await $.session.start({ cwd: '/', surface: 'vscode', isInteractive: true })
  await $.tool.call({ tool: 'Bash', command: 'uzun', run_in_background: true })
  const { ui } = await office($)
  await ui.press({ key: 'is-me:b1' })
  const newest = String((await ui.find({ type: 'Code' }))?.props.source)
  expect(newest).toContain('satır 11999')
  expect(newest).not.toContain('satır 00000')
  expect(newest.length).toBeLessThanOrEqual(90000)
  expect(await ui.find({ key: 'daha-yeni' })).toBeUndefined()
  for (let pages = 0; pages < 10 && (await ui.find({ key: 'daha-eski' })); pages += 1) await ui.press({ key: 'daha-eski' })
  const oldest = String((await ui.find({ type: 'Code' }))?.props.source)
  expect(oldest.startsWith('satır 00000')).toBe(true)
  expect(await ui.find({ key: 'daha-eski' })).toBeUndefined()
  await ui.press({ key: 'en-yeni' })
  expect(String((await ui.find({ type: 'Code' }))?.props.source)).toContain('satır 11999')
  await ui.unmount()
})

const peerJob = {
  id: 'b9',
  kind: 'shell',
  tool: 'Bash',
  title: 'pytest tests/ui',
  command: 'python -m pytest tests/ui -q',
  output: `${TEMP_DIR}\\claude\\h1\\other\\tasks\\b9.output`,
  by: 'Şef',
  startedAt: NOW - 20 * MINUTE,
  endedAt: null,
  status: 'running',
  summary: '',
}

const peerWithJob = (updatedAt: number) =>
  JSON.stringify({ ...JSON.parse(peer('other', 'Giriş hatası', NOW - 15 * MINUTE, updatedAt)), jobs: [peerJob] })

test("another chat's job shows in every pane, even after its chat left the office; stopping it asks twice", { timeoutMs: 15000 }, async ($, on) => {
  const files = new Map([
    [`${LIVE}/slot-0.json`, peerWithJob(NOW - 2000)],
    [peerJob.output, 'collected 40 items\n'],
  ])
  const { clock } = world(on, files)
  await $.session.start({ cwd: '/', surface: 'vscode', isInteractive: true })
  const first = await office($)
  expect(await jobButton(first.ui, 'other:b9')).toContain('#1 pytest tests/ui')
  expect(await jobButton(first.ui, 'other:b9')).toContain('20 dk 0 sn')
  // Nobody works in that chat: the job may have been forgotten.
  expect(await jobButton(first.ui, 'other:b9')).toContain('sohbeti boşta')
  await first.ui.unmount()

  // Its chat sat past the waiting room's limit and left the drawing: the job stays listed.
  await clock.advance(20 * MINUTE)
  files.set(norm(`${LIVE}/slot-0.json`), peerWithJob(NOW + 20 * MINUTE - 1000))
  await clock.advance(3000)
  const { ui, alt } = await office($)
  expect(alt).not.toContain('Giriş hatası')
  expect(await jobButton(ui, 'other:b9')).toContain('#1 pytest tests/ui')

  await ui.press({ key: 'is-other:b9' })
  expect(String((await ui.find({ type: 'Code' }))?.props.source)).toBe('collected 40 items\n')
  // A first press asks, a second asks again, and either can be taken back.
  await ui.press({ key: 'is-durdur' })
  expect(await ui.find({ key: 'is-durdur' })).toBeUndefined()
  await ui.press({ key: 'durdur-vazgec' })
  expect(await ui.find({ key: 'durdur-onay-1' })).toBeUndefined()
  await ui.press({ key: 'is-durdur' })
  await ui.press({ key: 'durdur-onay-1' })
  expect(await ui.find({ key: 'durdur-onay-1' })).toBeUndefined()
  expect(files.has(norm(`${LIVE}/stop/other.json`))).toBe(false)
  await ui.press({ key: 'durdur-onay-2' })

  // Only a session stops its own tasks: the request waits for that chat in the live folder.
  const asked = JSON.parse(String(files.get(norm(`${LIVE}/stop/other.json`)))) as Record<string, number>
  expect(Object.keys(asked)).toEqual(['b9'])
  expect(await ui.find({ key: 'is-durdur' })).toBeUndefined()
  await ui.press({ key: 'ofise-don' })
  expect(await jobButton(ui, 'other:b9')).toContain('durdurma istendi')
  await ui.unmount()
})

test("a chat stops its own job with TaskStop when another chat's pane asks", { timeoutMs: 15000 }, async ($, on) => {
  const { clock, files, calls, toasts } = world(on, new Map(), { tool: bashInBackground('b1') })
  await $.session.start({ cwd: '/', surface: 'vscode', isInteractive: true })
  await $.turn.start({ text: 'izle', turnId: 't1' })
  await $.tool.call({ tool: 'Bash', command: 'npm run watch', run_in_background: true })
  await $.turn.complete({ ...ANSWER, turnId: 't1' })

  files.set(norm(`${LIVE}/stop/me.json`), JSON.stringify({ b1: NOW + 1000 }))
  await clock.advance(3000)
  expect(calls.map(call => [call.tool, call.task_id])).toEqual([['TaskStop', 'b1']])
  expect(toasts.at(-1)).toBe('Başka bir sohbetin panelinden durduruldu: npm run watch')
  const slot = JSON.parse(String(files.get(norm(`${LIVE}/slot-0.json`)))) as { jobs: { id: string; status: string }[]; workers: { status: string }[] }
  expect(slot.jobs.map(job => `${job.id} ${job.status}`)).toEqual(['b1 killed'])
  // The pane's own call is no work of the chief's.
  expect(slot.workers[0]?.status).toBe('idle')

  // The request is answered once.
  await clock.advance(3000)
  expect(calls.length).toBe(1)
})

test('this chat stops its own job at once, after the same two confirmations', { timeoutMs: 15000 }, async ($, on) => {
  const { calls } = world(on, new Map(), { tool: bashInBackground('b1') })
  await $.session.start({ cwd: '/', surface: 'vscode', isInteractive: true })
  await $.tool.call({ tool: 'Bash', command: 'npm run watch', run_in_background: true })
  const { ui } = await office($)
  await ui.press({ key: 'is-me:b1' })
  await ui.press({ key: 'is-durdur' })
  await ui.press({ key: 'durdur-onay-1' })
  expect(calls.length).toBe(0)
  await ui.press({ key: 'durdur-onay-2' })
  expect(calls.map(call => [call.tool, call.task_id])).toEqual([['TaskStop', 'b1']])
  expect(await ui.find({ type: 'Text', text: 'durduruldu' })).toBeDefined()
  expect(await ui.find({ key: 'is-durdur' })).toBeUndefined()
  await ui.unmount()
})

test("a job ends by its notification, or by leaving the engine's list; one never seen joins", { timeoutMs: 15000 }, async ($, on) => {
  let next = 1
  const { clock } = world(on, new Map(), {
    tool: e => (e.tool === 'Bash' && e.run_in_background ? bashInBackground(`b${next++}`)(e) : undefined),
  })
  await $.session.start({ cwd: '/', surface: 'vscode', isInteractive: true })
  await $.turn.start({ text: 'iki iş', turnId: 't1' })
  await $.tool.call({ tool: 'Bash', command: 'npm test', run_in_background: true })
  await $.tool.call({ tool: 'Bash', command: 'npm run lint', run_in_background: true })
  await $.turn.complete({ ...ANSWER, turnId: 't1' })

  const notice =
    '<task-notification>\n<task-id>b1</task-id>\n<status>failed</status>\n<summary>Background command "npm test" failed with exit code 1</summary>\n</task-notification>'
  await $.prompt.submit({ text: notice, wait: false, origin: { kind: 'task-notification' } })
  // The notification's turn is no new task of the chat.
  await $.turn.start({ text: notice, turnId: 't2' })
  const { ui, alt } = await office($)
  expect(alt).toContain('iki iş')
  expect(await jobButton(ui, 'me:b1')).toContain('hata verdi')
  await ui.press({ key: 'is-me:b1' })
  expect(await ui.find({ type: 'Text', text: 'failed with exit code 1' })).toBeDefined()
  await ui.unmount()

  await clock.advance(10000)
  const stop = { session_id: 'me', transcript_path: '', cwd: '', hook_event_name: 'Stop' as const, stop_hook_active: false }
  await $.classic.Stop({ ...stop, background_tasks: [{ id: 'b7', type: 'shell', status: 'running', description: 'Sunucu', command: 'npm run dev' }] })
  const after = await office($)
  await after.ui.press({ key: 'ofise-don' })
  expect(await jobButton(after.ui, 'me:b2')).toContain('bitti')
  expect(await jobButton(after.ui, 'me:b7')).toContain('Sunucu')
  expect(await jobButton(after.ui, 'me:b7')).toContain('çalışıyor')
  await after.ui.unmount()
})

test("a subagent sent to the background is a job; its transcript reads as a log", { timeoutMs: 15000 }, async ($, on) => {
  const log = [
    { type: 'user', message: { role: 'user', content: 'Arama ekranını incele' } },
    { type: 'assistant', message: { content: [{ type: 'text', text: 'Önce arama kodunu buluyorum.' }, { type: 'tool_use', name: 'Grep', input: { pattern: 'SearchBox' } }] } },
    { type: 'user', message: { content: [{ type: 'tool_result', content: 'src/search.tsx:12' }] } },
  ]
    .map(row => JSON.stringify(row))
    .join('\n')
  const files = new Map([
    [TRANSCRIPT, ''],
    [`${HOME}/.claude/projects/C--work-demo-app/me/subagents/agent-a1.jsonl`, `${log}\n`],
  ])
  const agents = [{ id: 'a1', status: 'running' }]
  const { clock } = world(on, files, { agents })
  await $.session.start({ cwd: '/', surface: 'vscode', isInteractive: true })
  await $.turn.start({ text: 'araştır', turnId: 't1' })
  await $.agent.spawn({ ...SPAWN, background: true, prompt: 'Arama ekranını incele', description: 'arama ekranı', subagentType: 'Explore' })

  const { ui } = await office($)
  expect(await jobButton(ui, 'me:a1')).toContain('arama ekranı')
  await ui.press({ key: 'is-me:a1' })
  const text = String((await ui.find({ type: 'Code' }))?.props.source)
  expect(text).toBe('— Görev —\nArama ekranını incele\nÖnce arama kodunu buluyorum.\n▶ Grep: SearchBox\n  ↳ src/search.tsx:12')
  await ui.unmount()

  agents[0] = { id: 'a1', status: 'completed' }
  await clock.advance(3000)
  const after = await office($)
  expect(await after.ui.find({ type: 'Text', text: 'bitti' })).toBeDefined()
  await after.ui.unmount()
})
