import { expect, mock, test } from 'claude-code/testing'
import type { On } from 'claude-code'

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
const HOME = 'C:\\Users\\demo'
const LIVE = `${HOME}/.claude/pixel-ofis-live`

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

const chief = (task: string, tool: string | null) => ({
  id: 'main',
  name: 'Şef',
  role: 'ana oturum',
  status: tool ? 'working' : 'idle',
  station: tool ? 'desk' : 'coffee',
  tool,
  task,
  tools: 1,
  startedAt: 0,
})

// The engine hands the hooks a path in the platform's spelling: the disk below does too.
const norm = (path: string): string => path.replace(/\//g, '\\')

// The engine beneath the plugin: a session, a disk in memory and the person's actions.
function world(
  on: On,
  files: Map<string, string> = new Map(),
  stats: Record<string, 'file' | 'dir'> = {},
  fill: { isFilled: boolean; refusal?: 'no_composer' | 'dialog' } = { isFilled: true },
) {
  const submitted: string[] = []
  const toasts: string[] = []
  const filled: string[] = []
  const notes: string[] = []
  const sends: string[] = []
  for (const [path, text] of [...files]) {
    files.delete(path)
    files.set(norm(path), text)
  }
  const clock = mock.clock(on, { now: NOW })
  mock.env(on, { USERPROFILE: HOME })
  on('command.register', () => ({ value: { command: 'ofis' } }))
  on('ui.open', () => ({ value: { isPlaced: true } }))
  on('ui.toast', (_, e) => {
    toasts.push(e.text)

    return { value: undefined }
  })
  on('ui.log', () => ({ value: undefined }))
  on('session.usage', () => ({ value: USAGE }))
  on('session.id', () => ({ value: 'me' }))
  on('session.cwd', () => ({ value: 'C:\\work\\demo-app' }))
  on('session.start', (_, e) => ({ cwd: e.cwd }))
  on('session.end', (_, e) => ({ sessionId: e.sessionId }))
  on('turn.start', (_, e) => ({ turnId: e.turnId }))
  on('tool.call', () => ({ result: {} }))
  on('agent.spawn', () => ({ model: 'sonnet', agentId: 'a1' }))
  on('turn.complete', (_, e) => ({ text: e.answer }))
  on('prompt.submit', (_, e) => {
    submitted.push(e.text)
    notes.push((e.context ?? []).join('\n'))

    return { text: e.text }
  })
  on('tool.register', (_, e) => ({ value: { tool: `mcp__pixel-ofis__${e.name}` } }))
  on('session.send', (_, e) => {
    sends.push(e.text)

    return { isDelivered: true }
  })
  on('prompt.fill', (_, e) => {
    filled.push(e.text)

    return fill
  })
  on('fs.list', (_, e) => {
    const dir = e.path.replace(/\\/g, '/')
    const entries = [...files.keys()]
      .filter(path => path.replace(/\\/g, '/').startsWith(`${dir}/`))
      .map(path => ({ name: path.replace(/\\/g, '/').slice(dir.length + 1), kind: 'file' as const, size: 1, mtimeMs: NOW, isLink: false }))
    if (entries.length === 0) throw new Error('ENOENT')

    return { value: entries }
  })
  on('fs.read', (_, e) => {
    const text = files.get(norm(e.path))
    if (text === undefined) throw new Error('ENOENT')

    return { value: text }
  })
  on('fs.write', (_, e) => {
    files.set(norm(e.path), e.text)

    return { value: undefined }
  })
  on('fs.stat', (_, e) => {
    const kind = stats[norm(e.path)]
    if (!kind) throw new Error('ENOENT')

    return { value: { kind, size: 1, mtimeMs: NOW, isLink: false } }
  })

  return { clock, files, submitted, toasts, filled, notes, sends }
}

test('workers move to the station of their tool and a task given in the pane is sent once', async ($, on) => {
  const { submitted, toasts } = world(on)

  await $.session.start({ cwd: '/', surface: 'vscode', isInteractive: true })
  await $.turn.start({ text: 'testleri koş', turnId: 't1' })
  await $.tool.call({ tool: 'Bash', command: 'ls' })
  await $.agent.spawn({ ...SPAWN, prompt: 'dosyaları bul', description: 'dosya ara', subagentType: 'Explore' })
  await $.tool.call({ tool: 'Grep', pattern: 'x', agentId: 'a1' })

  const ui = await $.ui.mount({ ...PANE, surface: 'vscode' })
  const svg = await ui.find({ type: 'Svg' })
  expect(String(svg?.props.alt)).toContain('Şef: Bash')
  expect(String(svg?.props.alt)).toContain('Kaşif: Grep')
  expect(String(svg?.props.alt)).toContain('5 SAAT %42')
  const source = String(svg?.props.source)
  expect(source.startsWith('<svg')).toBe(true)
  expect(source.length).toBeLessThan(131072)
  expect(source).toContain('%88')
  expect(source).toContain('$1.25')
  // The board names the task being worked on.
  expect(source).toContain('GÖREVLER')
  expect(source).toContain('testleri koş')

  await ui.input({ key: 'gorev-0', text: '  rapor yaz  ' })
  expect(submitted).toEqual(['rapor yaz'])
  expect(toasts.at(-1)).toContain('sıraya alındı')
  // The field is drawn anew, empty, so the person sees the task left.
  expect(await ui.find({ key: 'gorev-1' })).toBeDefined()
  expect((await ui.find({ type: 'Text', text: /Sen: sıraya aldın/ }))?.text).toContain('rapor yaz')

  // Enter pressed again on the same task does not send it twice.
  await ui.input({ key: 'gorev-1', text: 'rapor yaz' })
  expect(submitted).toEqual(['rapor yaz'])
  expect(toasts.at(-1)).toContain('az önce gönderildi')
  await ui.unmount()

  await $.turn.complete({ answer: 'tamam', durationMs: 4000, isAborted: false, turnId: 't2', agentId: 'a1', reason: 'answer' })
  const after = await $.ui.mount({ ...PANE, surface: 'vscode' })
  const done = await after.find({ type: 'Svg' })
  expect(String(done?.props.alt)).toContain('Kaşif: bitti')
  expect((await after.find({ type: 'Text', text: /Kaşif: bitirdi/ }))?.text).toContain('1 araç')
  await after.unmount()
})

test('attachments: pasted paths and the latest screenshot go with the task as paths', async ($, on) => {
  const shots = `${HOME}\\Pictures\\Screenshots`
  const files = new Map([[`${shots}\\Ekran görüntüsü 1.png`, 'png']])
  const stats = { 'C:\\a b\\plan.pdf': 'file', [`${shots}\\Ekran görüntüsü 1.png`]: 'file' } as const
  const { submitted, toasts } = world(on, files, stats)
  await $.session.start({ cwd: '/', surface: 'vscode', isInteractive: true })

  const ui = await $.ui.mount({ ...PANE, surface: 'vscode' })
  await ui.input({ key: 'ek-yolu-0', text: '"C:\\a b\\plan.pdf" "C:\\yok.txt"' })
  expect(toasts.at(-1)).toContain('yok.txt')
  expect(await ui.find({ key: 'ek-C:\\a b\\plan.pdf' })).toBeDefined()
  expect(await ui.find({ key: 'ek-yolu-1' })).toBeDefined()

  await ui.press({ key: 'ek-ekran' })
  expect(await ui.find({ key: `ek-${shots}\\Ekran görüntüsü 1.png` })).toBeDefined()

  await ui.input({ key: 'gorev-0', text: 'şu planı incele' })
  expect(submitted.length).toBe(1)
  expect(submitted[0]).toContain('şu planı incele\n\nEkler (Read aracıyla aç):')
  expect(submitted[0]).toContain('- C:\\a b\\plan.pdf')
  expect(submitted[0]).toContain(`- ${shots}\\Ekran görüntüsü 1.png`)
  expect(await ui.find({ key: 'ek-C:\\a b\\plan.pdf' })).toBeUndefined()
  await ui.unmount()
})

test('the task and its attachments can be moved to the chat box instead', async ($, on) => {
  const { filled, submitted } = world(on, new Map(), { 'C:\\x.png': 'file' })
  await $.session.start({ cwd: '/', surface: 'vscode', isInteractive: true })

  const ui = await $.ui.mount({ ...PANE, surface: 'vscode' })
  await ui.input({ key: 'ek-yolu-0', text: 'C:\\x.png' })
  await ui.input({ key: 'gorev-0', text: 'resme bak', kind: 'change' })
  await ui.press({ key: 'kutuya-aktar' })
  expect(filled).toEqual(['resme bak\n\nEkler (Read aracıyla aç):\n- C:\\x.png'])
  expect(submitted).toEqual([])
  expect(await ui.find({ key: 'gorev-1' })).toBeDefined()
  await ui.unmount()
})

test('a chat box that does not take the text says so and keeps the task', async ($, on) => {
  const { toasts } = world(on, new Map(), {}, { isFilled: false })
  await $.session.start({ cwd: '/', surface: 'vscode', isInteractive: true })

  const ui = await $.ui.mount({ ...PANE, surface: 'vscode' })
  await ui.input({ key: 'gorev-0', text: 'x', kind: 'change' })
  await ui.press({ key: 'kutuya-aktar' })
  expect(toasts.at(-1)).toBe('Sohbet kutusuna aktarılamadı.')
  expect(await ui.find({ key: 'gorev-0' })).toBeDefined()
  await ui.unmount()
})

test('other chats working at the same time join the office; stale ones do not', async ($, on) => {
  const files = new Map([
    [`${LIVE}/slot-0.json`, JSON.stringify({ sessionId: 'other', project: 'demo-app', task: 'arama ekranı', purpose: 'arama ekranı', workers: [chief('arama ekranı', 'Edit')], updatedAt: NOW - 2000 })],
    [`${LIVE}/slot-2.json`, JSON.stringify({ sessionId: 'old', project: 'X', task: 'eski iş', workers: [chief('eski iş', 'Bash')], updatedAt: NOW - 3_600_000 })],
  ])
  const { clock } = world(on, files)
  await $.session.start({ cwd: '/', surface: 'vscode', isInteractive: true })
  await $.turn.start({ text: 'testleri koş\n\nEkler (Read aracıyla aç):\n- C:\\x.png', turnId: 't1' })
  await clock.advance(3000)

  // This chat wrote itself to the first free slot.
  const own = JSON.parse(files.get(norm(`${LIVE}/slot-1.json`)) ?? '{}')
  expect(own.sessionId).toBe('me')
  expect(own.task).toBe('testleri koş')

  const ui = await $.ui.mount({ ...PANE, surface: 'vscode' })
  const alt = String((await ui.find({ type: 'Svg' }))?.props.alt)
  expect(alt).toContain('Diğer sohbetler: Şef#1: Edit')
  expect(alt).not.toContain('eski iş')
  expect(String((await ui.find({ type: 'Svg' }))?.props.source)).toContain('arama ekranı')
  expect((await ui.find({ type: 'Text', text: /^Pano/ }))?.text).toBe('Pano · 2 sohbet çalışıyor')
  expect((await ui.find({ type: 'Text', text: /#1 ·/ }))?.text).toBe('#1 · çalışıyor (Edit) · arama ekranı')
  expect((await ui.find({ type: 'Text', text: /bu sohbet/ }))?.text).toBe('#2 bu sohbet · çalışıyor · testleri koş')
  await ui.unmount()

  // The other chat ends: it marks its slot, and leaves the office at the next look.
  files.set(norm(`${LIVE}/slot-0.json`), JSON.stringify({ sessionId: 'other', project: 'demo-app', task: '', workers: [], updatedAt: NOW, ended: true }))
  await clock.advance(3000)
  const later = await $.ui.mount({ ...PANE, surface: 'vscode' })
  expect(String((await later.find({ type: 'Svg' }))?.props.alt)).not.toContain('Diğer sohbetler')
  await later.unmount()

  await $.session.end({ reason: 'prompt_input_exit', sessionId: 'me', resume: { sessionId: 'me' } as never })
  expect(JSON.parse(files.get(norm(`${LIVE}/slot-1.json`)) ?? '{}').ended).toBe(true)
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
    updatedAt,
  })

test('the board keeps what this chat is for, its name and the files it changed', async ($, on) => {
  const { clock, files } = world(on)
  await $.session.start({ cwd: '/', surface: 'vscode', isInteractive: true })
  await $.turn.start({ text: 'pano ekle\nayrıntı', turnId: 't1' })
  await $.tool.call({ tool: 'Edit', file_path: SRC, old_string: 'a', new_string: 'b' })
  await clock.advance(3000)

  const journal = JSON.parse(files.get(norm(`${LIVE}/journal/me.json`)) ?? '{}')
  expect(journal.purpose).toBe('pano ekle')
  expect(journal.label).toBe('#1')
  expect(journal.files[0].path).toBe(SRC)

  const ui = await $.ui.mount({ ...PANE, surface: 'vscode' })
  expect((await ui.find({ type: 'Text', text: /^Pano/ }))?.text).toBe('Pano · yalnız bu sohbet çalışıyor')
  expect((await ui.find({ type: 'Text', text: /dosyalar:/ }))?.text).toContain('src/a.py')
  await ui.input({ key: 'ad-0', text: '  Ofis panosu  ' })
  expect((await ui.find({ type: 'Text', text: /bu sohbet ·/ }))?.text).toContain('Ofis panosu')
  expect((await ui.find({ type: 'Text', text: /amaç:/ }))?.text).toContain('amaç: pano ekle')
  expect(JSON.parse(files.get(norm(`${LIVE}/journal/me.json`)) ?? '{}').name).toBe('Ofis panosu')
  await ui.unmount()
})

test('a resumed chat finds its name and purpose on the board again', async ($, on) => {
  const before = JSON.stringify({ sessionId: 'me', label: '#4', project: 'demo-app', name: 'Eski ad', purpose: 'eski amaç', tasks: [], files: [], startedAt: 1, updatedAt: NOW - 1000 })
  world(on, new Map([[`${LIVE}/journal/me.json`, before]]))
  await $.session.start({ cwd: '/', surface: 'vscode', isInteractive: true })

  const ui = await $.ui.mount({ ...PANE, surface: 'vscode' })
  expect((await ui.find({ type: 'Text', text: /bu sohbet ·/ }))?.text).toContain('Eski ad')
  await ui.unmount()
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

test('the model reads the board beside a prompt, again only when it changed', async ($, on) => {
  const files = new Map([[`${LIVE}/slot-0.json`, OTHER([{ path: SRC, at: NOW - 60000, tool: 'Edit' }])]])
  const { clock, notes } = world(on, files)
  await $.session.start({ cwd: '/', surface: 'vscode', isInteractive: true })
  await clock.advance(3000)

  await $.prompt.submit({ text: 'bir iş', wait: false, origin: { kind: 'user' } as never })
  expect(notes[0]).toContain('[Piksel Ofis panosu')
  expect(notes[0]).toContain('#1 "Arama" (çalışıyor)')
  expect(notes[0]).toContain('Değiştirdiği dosyalar: src/a.py')
  expect(notes[0]).toContain('mcp__pixel-ofis__ofis_mesaj')

  await $.prompt.submit({ text: 'bir iş daha', wait: false, origin: { kind: 'user' } as never })
  expect(notes[1]).toBe('')

  files.set(norm(`${LIVE}/slot-0.json`), OTHER([{ path: 'C:\\work\\demo-app\\src\\c.py', at: NOW, tool: 'Write' }, { path: SRC, at: NOW - 60000, tool: 'Edit' }]))
  await clock.advance(3000)
  await $.prompt.submit({ text: 'üçüncü', wait: false, origin: { kind: 'user' } as never })
  expect(notes[2]).toContain('src/c.py, src/a.py')
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

test('ended chats of the last day stay on the board with what they changed', async ($, on) => {
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
  const { notes } = world(on, new Map([[`${LIVE}/journal/gone.json`, past]]))
  await $.session.start({ cwd: '/', surface: 'vscode', isInteractive: true })

  const ui = await $.ui.mount({ ...PANE, surface: 'vscode' })
  expect((await ui.find({ type: 'Text', text: /girişi/ }))?.text).toContain('src/login.py')
  await ui.unmount()

  await $.prompt.submit({ text: 'iş', wait: false, origin: { kind: 'user' } as never })
  expect(notes[0]).toContain('#3 "girişi düzelt" (kapandı)')

  const held = await $.tool.call({ tool: 'Write', file_path: 'C:\\work\\demo-app\\src\\login.py', content: 'x' })
  expect(JSON.stringify(held)).toContain('#3')
})

test('the terminal, which has no Svg, gets the office as text', async ($, on) => {
  mock.clock(on, { now: NOW })
  on('session.usage', () => ({ value: USAGE }))
  const ui = await $.ui.mount({ ...PANE, surface: 'terminal' })
  expect((await ui.find({ type: 'Text', text: /Piksel ofis/ }))?.text).toContain('Şef: boşta')
  await ui.unmount()
})
