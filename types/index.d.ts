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

// A file a chat changed through Edit, Write, MultiEdit or NotebookEdit.
export type FileChange = { path: string; at: number; tool: string }

// What a chat is for, kept on the board: its title (the one Claude Code shows for the
// session), its first task, its latest tasks and the files it changed.
export type BoardInfo = { name: string; purpose: string; tasks: string[]; files: FileChange[] }

// Another chat's team, as its own session last wrote it to the shared live folder.
// `activeAt`: when its main loop last started or finished a turn (absent from chats
// that run an older version of the mod).
export type Peer = BoardInfo & { sessionId: string; slot: number; project: string; task: string; workers: Worker[]; activeAt?: number }

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

// A turn's tokens as the API counted them.
export type TurnTokens = { input: number; cacheRead: number; cacheWrite: number; output: number }

// The last turn's tokens and when the main loop last heard from the model: the prompt
// cache's clock the HUD shows.
export type TokenStats = {
  last: TurnTokens | null
  lastResponseAt: number | null
}

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

// One team in the drawing: this chat's or a peer's. `waitingMs` is how long the chat
// has been waiting for its next task, null while anyone in it works.
export type Team = {
  label: string
  color: string
  isSelf: boolean
  title: string
  task: string
  files: number
  workers: Worker[]
  waitingMs: number | null
}

declare module 'claude-code' {
  interface PluginState {
    'pixel-ofis': {
      workers: Shaped<Worker[]>
      usage: Shaped<Usage | null>
      sharedLimits: Shaped<LimitReading[]>
      live: Shaped<Live>
      board: Shaped<BoardInfo>
      history: Shaped<Chronicle[]>
      tokens: Shaped<TokenStats>
      cacheTtl: Shaped<number | null>
      activeAt: Shaped<number>
      newer: Shaped<{ loaded: string; disk: string } | null>
    }
  }
}
