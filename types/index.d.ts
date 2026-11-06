export type Station = 'desk' | 'shelf' | 'terminal' | 'web' | 'board' | 'coffee'

export type WorkerStatus = 'working' | 'idle' | 'done' | 'error'

export type Worker = {
  id: string
  name: string
  role: string
  status: WorkerStatus
  station: Station
  tool: string | null
  task: string
  tools: number
  startedAt: number
}

export type LimitReading = { kind: string; percentUsed: number; resetsAt: string | null }

export type Usage = {
  contextPercent: number | null
  contextTokens: number | null
  contextWindow: number
  limits: LimitReading[]
  usd: number | null
}

export type LogEntry = { at: number; who: string; text: string }

// A file a chat changed through Edit, Write, MultiEdit or NotebookEdit.
export type FileChange = { path: string; at: number; tool: string }

// What a chat is for, kept on the board: the name the person gave it, its first
// task, its latest tasks and the files it changed.
export type BoardInfo = { name: string; purpose: string; tasks: string[]; files: FileChange[] }

// Another chat's team, as its own session last wrote it to the shared live folder.
export type Peer = BoardInfo & { sessionId: string; slot: number; project: string; task: string; workers: Worker[] }

// The live folder as this session sees it: the slot it writes, the chats it reads.
export type Live = { slot: number | null; peers: Peer[] }

// A chat's journal entry, kept after the chat ends: the board's history.
export type Chronicle = BoardInfo & {
  sessionId: string
  label: string
  project: string
  startedAt: number
  updatedAt: number
  ended?: true
}

export type Attachment = { path: string; name: string }

// Bumped to give a text field a new key, which draws it empty.
export type Rounds = { task: number; attach: number; name: number; defer: number }

// A turn's tokens as the API counted them.
export type TurnTokens = { input: number; cacheRead: number; cacheWrite: number; output: number }

// A tool result that took much of the context: what it was and its size in characters.
export type HeavyOutput = { tool: string; label: string; chars: number; at: number }

// What this chat spent: the last turn, the whole session, the heaviest tool results,
// and when the main loop last heard from the model (the prompt cache's clock).
export type TokenStats = {
  last: TurnTokens | null
  total: TurnTokens
  turns: number
  heavy: HeavyOutput[]
  byTool: Record<string, number>
  lastResponseAt: number | null
}

// What every request carries before the conversation itself: the context breakdown's
// rows and the largest memory files, as estimated tokens.
export type LoadRow = { name: string; tokens: number }
export type FixedLoad = { rows: LoadRow[]; memory: LoadRow[]; measuredAt: number }

// A subagent's report kept for the other chats, so they need not research it again.
export type Finding = {
  id: string
  sessionId: string
  label: string
  project: string
  type: string
  description: string
  prompt: string
  summary: string
  at: number
}

// A tool the model sees in the prompt's list, and the size of its description.
export type ToolSize = { tool: string; tokens: number; isDeferred: boolean }

// One team in the drawing: this chat's or a peer's.
export type Team = {
  label: string
  color: string
  isSelf: boolean
  title: string
  task: string
  files: number
  workers: Worker[]
}

declare module 'claude-code' {
  interface PluginState {
    'pixel-ofis': {
      workers: Shaped<Worker[]>
      log: Shaped<LogEntry[]>
      usage: Shaped<Usage | null>
      live: Shaped<Live>
      board: Shaped<BoardInfo>
      history: Shaped<Chronicle[]>
      attachments: Shaped<Attachment[]>
      rounds: Shaped<Rounds>
      canFill: Shaped<boolean>
      tokens: Shaped<TokenStats>
      load: Shaped<FixedLoad | null>
      findings: Shaped<Finding[]>
      deferred: Shaped<string[]>
      toolSizes: Shaped<ToolSize[]>
      cacheTtl: Shaped<number | null>
    }
  }
}
