/**
 * Transcript folding: the pure projection from one Session event window to
 * the chat panel's bubble model.
 *
 * Entries are read structurally (a compacted or future event keeps its
 * `type`/`seq`/`data` envelope), and unknown event types pass through
 * ignored, matching the merge-extensible `SessionEventMap`. One turn folds
 * into one process group — tool calls, reasoning, and intermediate text —
 * plus the turn's closing assistant text lifted out as its own bubble once
 * the turn is done, mirroring the default conversation's collapse-on-finish
 * behavior.
 */

/** One tool invocation inside a process group. */
export interface TranscriptToolStep {
  readonly kind: 'tool'
  /** Call identity correlating `tool/call`, live deltas, and `tool/result`. */
  readonly id: string
  /** Tool name; absent while a live delta has not carried one yet. */
  readonly name: string
  /** Raw JSON arguments accumulated from deltas or the durable call. */
  readonly args: string
  /** First result text blocks, capped; absent until the result lands. */
  readonly result?: string
  /** Whether the tool reported an error. */
  readonly isError: boolean
}

/** One assistant text passage inside a process group. */
export interface TranscriptTextStep {
  readonly kind: 'text'
  readonly id: string
  readonly text: string
  /** True while the passage is a live streaming accumulation. */
  readonly streaming: boolean
}

/** One reasoning passage inside a process group. */
export interface TranscriptReasoningStep {
  readonly kind: 'reasoning'
  readonly id: string
  readonly text: string
  readonly streaming: boolean
}

/** One intermediate step of a turn's process group. */
export type TranscriptStep = TranscriptToolStep | TranscriptTextStep | TranscriptReasoningStep

/** One user bubble. */
export interface TranscriptUserEntry {
  readonly kind: 'user'
  readonly id: string
  readonly text: string
}

/** One closing assistant bubble rendered as markdown. */
export interface TranscriptAssistantEntry {
  readonly kind: 'assistant'
  readonly id: string
  readonly text: string
  readonly streaming: boolean
}

/** One turn's collapsible intermediate steps. */
export interface TranscriptProcessEntry {
  readonly kind: 'process'
  readonly id: string
  readonly steps: readonly TranscriptStep[]
  /** Whether the turn reached `turn/end`. */
  readonly done: boolean
}

/** One chat panel row. */
export type TranscriptEntry =
  | TranscriptUserEntry
  | TranscriptAssistantEntry
  | TranscriptProcessEntry

/** The structural event-window entry shape the fold consumes. */
export interface TranscriptEventEntry {
  readonly type: 'event' | 'transient'
  readonly event: {
    readonly type: string
    readonly seq: number
    readonly data?: unknown
  }
}

/** Maximum characters retained from one tool result. */
const RESULT_CHAR_CAP = 2000

/**
 * Prefixes and markers of host-injected context deliveries that ride in as
 * user messages but are not human turns: workspace-instruction and skill
 * reminders, and runtime-context snapshots. The studio chat shows only real
 * conversation, so these are folded away.
 */
const SYSTEM_INJECTION_MARKERS = [
  '<system-reminder>',
  '<available_skills>',
  'Current runtime context.',
] as const

/**
 * Test whether one user-message text is a host-injected context delivery
 * rather than a human turn.
 * @param text - the folded user message text.
 * @returns true when the text is system-injected and must not render.
 */
function isSystemInjection(text: string): boolean {
  return SYSTEM_INJECTION_MARKERS.some(marker => text.includes(marker))
}

function recordOf(value: unknown): Record<string, unknown> | undefined {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
    ? value as Record<string, unknown>
    : undefined
}

function textOfBlocks(content: unknown): string {
  if (!Array.isArray(content)) return ''
  const parts: string[] = []
  for (const block of content) {
    const record = recordOf(block)
    if (record?.type === 'text' && typeof record.text === 'string') parts.push(record.text)
  }
  return parts.join('\n')
}

interface MutableToolStep {
  kind: 'tool'
  id: string
  name: string
  args: string
  result?: string
  isError: boolean
}

interface MutableTextStep {
  kind: 'text' | 'reasoning'
  id: string
  text: string
  streaming: boolean
}

type MutableStep = MutableToolStep | MutableTextStep

interface MutableGroup {
  kind: 'process'
  id: string
  steps: MutableStep[]
  done: boolean
}

type MutableEntry =
  | { kind: 'user'; id: string; text: string }
  | { kind: 'assistant'; id: string; text: string; streaming: boolean }
  | MutableGroup

function capResult(text: string): string {
  return text.length > RESULT_CHAR_CAP ? `${text.slice(0, RESULT_CHAR_CAP)}…` : text
}

function appendTextStep(
  group: MutableGroup,
  id: string,
  kind: 'text' | 'reasoning',
  delta: string,
  streaming: boolean,
): void {
  const existing = group.steps.find(step => step.id === id && step.kind === kind) as
    | MutableTextStep
    | undefined
  if (existing !== undefined) {
    existing.text += delta
    return
  }
  group.steps.push({ kind, id, text: delta, streaming })
}

function toolStepOf(group: MutableGroup, id: string): MutableToolStep {
  const existing = group.steps.find(step => step.id === id && step.kind === 'tool') as
    | MutableToolStep
    | undefined
  if (existing !== undefined) return existing
  const created: MutableToolStep = { kind: 'tool', id, name: '', args: '', isError: false }
  group.steps.push(created)
  return created
}

function foldLiveChunk(group: MutableGroup, data: Record<string, unknown>): void {
  const chunk = recordOf(data.chunk)
  if (chunk === undefined) return
  const attemptId = typeof data.attemptId === 'string' ? data.attemptId : 'live'
  const index = typeof chunk.index === 'number' ? String(chunk.index) : '0'
  switch (chunk.type) {
    case 'text-delta':
      if (typeof chunk.text === 'string') {
        appendTextStep(group, `live-t-${attemptId}-${index}`, 'text', chunk.text, true)
      }
      return
    case 'reasoning-delta':
      if (typeof chunk.text === 'string') {
        appendTextStep(group, `live-r-${attemptId}-${index}`, 'reasoning', chunk.text, true)
      }
      return
    case 'tool-call-delta': {
      const callId = typeof chunk.id === 'string' ? chunk.id : `live-c-${attemptId}-${index}`
      const step = toolStepOf(group, callId)
      if (step.name === '' && typeof chunk.name === 'string') step.name = chunk.name
      if (typeof chunk.argumentsDelta === 'string') step.args += chunk.argumentsDelta
      return
    }
    default:
      return
  }
}

function foldAssistantMessage(group: MutableGroup, seq: number, data: Record<string, unknown>): void {
  const message = recordOf(data.message)
  if (message === undefined) return
  const content = message.content
  if (!Array.isArray(content)) return
  let ordinal = 0
  for (const block of content) {
    const record = recordOf(block)
    ordinal += 1
    if (record === undefined) continue
    const id = `am-${String(seq)}-${String(ordinal)}`
    switch (record.type) {
      case 'text':
        if (typeof record.text === 'string' && record.text.length > 0) {
          group.steps.push({ kind: 'text', id, text: record.text, streaming: false })
        }
        return
      case 'reasoning':
        if (typeof record.text === 'string' && record.text.length > 0) {
          group.steps.push({ kind: 'reasoning', id, text: record.text, streaming: false })
        }
        return
      case 'tool-call': {
        const callId = typeof record.id === 'string' ? record.id : id
        const step = toolStepOf(group, callId)
        if (typeof record.name === 'string' && record.name.length > 0) step.name = record.name
        if (typeof record.arguments === 'string') step.args = record.arguments
        return
      }
      default:
        return
    }
  }
}

function foldToolResult(entries: MutableEntry[], data: Record<string, unknown>): void {
  const message = recordOf(data.message)
  const source = recordOf(message?.source)
  const block = Array.isArray(message?.content) ? recordOf(message.content[0]) : undefined
  const callId = source?.callId ?? block?.toolCallId
  if (typeof callId !== 'string') return
  for (let index = entries.length - 1; index >= 0; index -= 1) {
    const entry = entries[index]
    if (entry === undefined || entry.kind !== 'process') continue
    const step = entry.steps.find(candidate => candidate.id === callId && candidate.kind === 'tool') as
      | MutableToolStep
      | undefined
    if (step === undefined) continue
    step.result = capResult(textOfBlocks(block?.content))
    step.isError = block?.isError === true
    return
  }
}

/**
 * Fold one contiguous event window into chat panel rows.
 * @param entries - window entries in log order (durable events and transient live chunks).
 * @returns user bubbles, per-turn process groups, and closing assistant bubbles.
 */
export function foldTranscript(entries: readonly TranscriptEventEntry[]): readonly TranscriptEntry[] {
  const entriesOut: MutableEntry[] = []
  let group: MutableGroup | undefined

  const closeGroup = (): void => {
    if (group === undefined) return
    group.done = true
    group = undefined
  }
  const ensureGroup = (seq: number): MutableGroup => {
    if (group !== undefined) return group
    const created: MutableGroup = { kind: 'process', id: `turn-${String(seq)}`, steps: [], done: false }
    entriesOut.push(created)
    group = created
    return created
  }

  for (const entry of entries) {
    const event = entry.event
    const data = recordOf(event.data)
    switch (event.type) {
      case 'user/message': {
        if (data === undefined) break
        const source = recordOf(data.source)
        if (source?.kind === 'tool') break
        const text = textOfBlocks(data.content)
        if (text.length === 0) break
        if (isSystemInjection(text)) break
        closeGroup()
        entriesOut.push({ kind: 'user', id: `u-${String(event.seq)}`, text })
        break
      }
      case 'turn/start':
        closeGroup()
        ensureGroup(event.seq)
        break
      case 'turn/end':
        closeGroup()
        break
      case 'assistant/live-chunk':
        if (entry.type === 'transient' && data !== undefined) {
          foldLiveChunk(ensureGroup(event.seq), data)
        }
        break
      case 'assistant/message':
        if (data !== undefined) foldAssistantMessage(ensureGroup(event.seq), event.seq, data)
        break
      case 'tool/call': {
        if (data === undefined) break
        const current = ensureGroup(event.seq)
        const callId = typeof data.callId === 'string' ? data.callId : `tc-${String(event.seq)}`
        const step = toolStepOf(current, callId)
        if (typeof data.name === 'string' && data.name.length > 0) step.name = data.name
        if (typeof data.arguments === 'string') step.args = data.arguments
        break
      }
      case 'tool/result':
        if (data !== undefined) foldToolResult(entriesOut, data)
        break
      default:
        break
    }
  }

  return liftClosingText(entriesOut)
}

/**
 * Lift each finished group's last text passage out as the turn's closing
 * assistant bubble; a group left without steps disappears.
 * @param entries - folded mutable rows.
 * @returns the immutable render rows.
 */
function liftClosingText(entries: readonly MutableEntry[]): readonly TranscriptEntry[] {
  const rows: TranscriptEntry[] = []
  for (const entry of entries) {
    if (entry.kind !== 'process') {
      rows.push(entry)
      continue
    }
    if (!entry.done) {
      rows.push({ ...entry, steps: [...entry.steps] })
      continue
    }
    let lastTextIndex = -1
    for (let index = entry.steps.length - 1; index >= 0; index -= 1) {
      const step = entry.steps[index]
      if (step !== undefined && step.kind === 'text' && step.text.trim().length > 0) {
        lastTextIndex = index
        break
      }
    }
    const lifted = lastTextIndex >= 0 ? entry.steps[lastTextIndex] as MutableTextStep : undefined
    const steps = lifted === undefined
      ? [...entry.steps]
      : entry.steps.filter((_, index) => index !== lastTextIndex)
    if (steps.length > 0) rows.push({ ...entry, steps })
    if (lifted !== undefined) {
      rows.push({ kind: 'assistant', id: lifted.id, text: lifted.text, streaming: false })
    }
  }
  return rows
}
