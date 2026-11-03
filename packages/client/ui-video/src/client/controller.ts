/**
 * The studio's object layer: one controller owns the studio's reactive facts
 * (open state, project rows, active project detail, chat transcript, the
 * shared playhead/zoom clock, and any pending ask_user_question) and the verbs
 * components call. Everything arrives from existing Client services —
 * `ctx.sessions` for the catalog and Session bindings, `ctx.remote` for
 * workspace files, directory picking, and preset selection, and
 * `ctx.uiSession` for the active session's pending interaction — so the
 * browser half adds no Host surface.
 *
 * Sources are bare `ObservableSnapshot` values published through the
 * registration's `hooks` compartment; components never see this class.
 */
import { createSnapshotStore, type SnapshotStore } from '@deepseek-ai/dsh-client-store'
import type { ClientRemote } from '@deepseek-ai/dsh-api-remotes/client'
import type {
  ISessions, SessionBinding, SessionListState, SessionReference,
} from '@deepseek-ai/dsh-api-session-controller/client'
import type { UiSession } from '@deepseek-ai/dsh-client-ui-session/client'
import type { SessionId } from '@deepseek-ai/dsh-session/types'
import { foldTranscript, type TranscriptEntry } from './transcript.ts'
import {
  parseScript, resolveShots, shotSpans, totalSeconds,
  type ResolvedShot, type VideoScript,
} from './script.ts'

/** One video project row in the studio's project list. */
export interface VideoProjectRow {
  /** The session identity backing the project. */
  readonly sessionId: SessionId
  /** Display title: the session's durable title, directory name, or raw id. */
  readonly title: string
  /** The session's working directory, when the catalog carries one. */
  readonly cwd?: string
  /** Whether the agent is mid-turn. */
  readonly running: boolean
  /** Last activity time in epoch milliseconds. */
  readonly updatedAt: number
}

/** One selectable choice of a pending ask_user_question. */
export interface PendingQuestionOption {
  /** Option label submitted as the answer when chosen. */
  readonly label: string
  /** Supporting copy shown under the label. */
  readonly description?: string
}

/** One question of a pending ask_user_question batch. */
export interface PendingQuestionItem {
  /** Stable question id echoed in the answer. */
  readonly id: string
  /** The question text. */
  readonly question: string
  /** Short heading/group label. */
  readonly header?: string
  /** Choices rendered as numbered cards. */
  readonly options: readonly PendingQuestionOption[]
  /** Whether more than one option may be selected. */
  readonly multiSelect: boolean
}

/** The active session's pending ask_user_question, as plain render data. */
export interface PendingQuestionView {
  /** Opaque identity of the pending batch; absent when nothing is pending. */
  readonly key?: string
  /** Questions awaiting an answer, empty when none is pending. */
  readonly questions: readonly PendingQuestionItem[]
}

/** One structured answer line submitted for a pending question. */
export interface PendingAnswerLine {
  /** The answered question id. */
  readonly id: string
  /** Selected option labels. */
  readonly selected: readonly string[]
  /** Optional free-text answer accompanying the selection. */
  readonly custom?: string
}

/** Studio-level view state shared by every registration. */
export interface StudioState {
  /** Whether the full-screen studio overlay renders. */
  readonly open: boolean
  /** The project session the center and right panels follow. */
  readonly activeSessionId?: SessionId
  /** The shot the preview and timeline highlight. */
  readonly selectedShotId?: string
  /** Whether a create-project flow is in flight. */
  readonly creating: boolean
  /** Latest operation failure to surface, already localized by the caller. */
  readonly error?: string
  /** Playhead position in seconds from the film head. */
  readonly playhead: number
  /** Whether the preview clock is advancing. */
  readonly playing: boolean
  /** Timeline horizontal scale in pixels per second. */
  readonly pxPerSecond: number
}

/** Load status of the active project's `script.json`. */
export type ProjectStatus = 'idle' | 'loading' | 'ready' | 'missing' | 'error'

/** The active project's parsed script and resolved media. */
export interface ProjectState {
  /** Current load status. */
  readonly status: ProjectStatus
  /** Session working directory the search started from. */
  readonly cwd?: string
  /** Absolute directory holding `script.json`. */
  readonly projectDir?: string
  /** Parsed contract, when status is `ready`. */
  readonly script?: VideoScript
  /** Shots in playback order with absolute media paths. */
  readonly shots: readonly ResolvedShot[]
  /** Absolute path of the newest rendered video, when one exists. */
  readonly renderPath?: string
  /** Failure text for status `error`. */
  readonly error?: string
}

/** The active session's folded chat transcript. */
export interface TranscriptState {
  /** Chat rows in log order. */
  readonly entries: readonly TranscriptEntry[]
  /** Whether the agent is mid-turn. */
  readonly running: boolean
  /** Whether the session's history window has loaded at least once. */
  readonly loaded: boolean
}

const IDLE_PROJECT: ProjectState = { status: 'idle', shots: [] }
const IDLE_TRANSCRIPT: TranscriptState = { entries: [], running: false, loaded: false }
const IDLE_PENDING: PendingQuestionView = { questions: [] }
const IDLE_STUDIO: StudioState = { open: false, creating: false, playhead: 0, playing: false, pxPerSecond: 48 }

/** The agent preset every studio project session runs. */
export const VIDEO_PRESET_ID = 'video'

/** Maximum project subdirectories probed for a nested `script.json`. */
const PROJECT_SCAN_LIMIT = 32

/** Suffixes treated as a finished render. */
const RENDER_SUFFIXES = ['.mp4', '.webm', '.mov'] as const

/** Playhead clock granularity in milliseconds. */
const CLOCK_INTERVAL_MS = 100

/** Horizontal scale bounds in pixels per second. */
const MIN_PX_PER_SECOND = 8
const MAX_PX_PER_SECOND = 240

/** Structural view of the ui-session pending interaction this studio answers. */
interface PendingQuestionLike {
  readonly kind: string
  readonly key: string
  readonly questions: readonly Record<string, unknown>[]
  answer: (answer: { answers: readonly PendingAnswerLine[] }) => Promise<void>
}

function decodeBase64Text(data: string): string {
  const binary = atob(data)
  const bytes = Uint8Array.from(binary, char => char.charCodeAt(0))
  return new TextDecoder().decode(bytes)
}

function failureText(result: { ok: boolean; error?: { message: string } }): string {
  return result.ok ? 'unknown error' : (result.error?.message ?? 'unknown error')
}

function stringOf(value: unknown): string | undefined {
  return typeof value === 'string' ? value : undefined
}

/**
 * Narrow one ui-session pending interaction to an answerable question batch.
 * @param value - the pending interaction published for the active session.
 * @returns the question presentation, or undefined for other interaction kinds.
 */
function pendingQuestionOf(value: unknown): PendingQuestionLike | undefined {
  if (typeof value !== 'object' || value === null) return undefined
  const candidate = value as Partial<PendingQuestionLike>
  if (candidate.kind !== 'question') return undefined
  if (!Array.isArray(candidate.questions)) return undefined
  if (typeof candidate.answer !== 'function') return undefined
  if (typeof candidate.key !== 'string') return undefined
  return value as PendingQuestionLike
}

/**
 * Project one wire question record onto the plain render shape.
 * @param record - one question of the pending batch.
 * @param position - zero-based position used to synthesize a missing id.
 * @returns the render-ready question.
 */
function pendingItemOf(record: Record<string, unknown>, position: number): PendingQuestionItem {
  const optionsRaw = Array.isArray(record.options) ? record.options : []
  const options: PendingQuestionOption[] = []
  for (const entry of optionsRaw) {
    if (typeof entry !== 'object' || entry === null) continue
    const option = entry as Record<string, unknown>
    const label = stringOf(option.label)
    if (label === undefined) continue
    const description = stringOf(option.description)
    options.push({ label, ...(description === undefined ? {} : { description }) })
  }
  const header = stringOf(record.header)
  return {
    id: stringOf(record.id) ?? `q-${String(position + 1)}`,
    question: stringOf(record.question) ?? '',
    ...(header === undefined ? {} : { header }),
    options,
    multiSelect: record.multiSelect === true,
  }
}

/**
 * Owns the video studio's state and verbs for the lifetime of the plugin
 * fiber. One instance is created in `apply` and shared by every registration
 * through inject closures.
 */
export class VideoStudioController {
  /** Studio view state. */
  readonly studio: SnapshotStore<StudioState> = createSnapshotStore<StudioState>(IDLE_STUDIO)
  /** Video project rows derived from the session catalog. */
  readonly projects: SnapshotStore<readonly VideoProjectRow[]> = createSnapshotStore([])
  /** Active project detail. */
  readonly project: SnapshotStore<ProjectState> = createSnapshotStore(IDLE_PROJECT)
  /** Active session transcript. */
  readonly transcript: SnapshotStore<TranscriptState> = createSnapshotStore(IDLE_TRANSCRIPT)
  /** Active session's pending ask_user_question, as plain render data. */
  readonly pending: SnapshotStore<PendingQuestionView> = createSnapshotStore(IDLE_PENDING)

  private reference: SessionReference | undefined
  private bindingUnsubs: Array<() => void> = []
  private statusUnsub: (() => void) | undefined
  private loadAbort: AbortController | undefined
  private clock: ReturnType<typeof setInterval> | undefined
  private pendingLive: PendingQuestionLike | undefined
  private dismissed = new Set<SessionId>()
  private lastRunning = false

  /**
   * @param sessions - Client session catalog and binding owner.
   * @param remote - generated Remote namespaces (workspaceFiles, directoryPicker, agentPresets).
   * @param uiSession - per-session UI status carrying pending interactions.
   */
  constructor(
    private readonly sessions: ISessions,
    private readonly remote: ClientRemote,
    private readonly uiSession: UiSession,
  ) {
    sessions.list.subscribe(() => { this.refreshProjects() })
    this.statusUnsub = uiSession.sessionStatus.subscribe(() => { this.syncPending() })
    this.refreshProjects()
    this.syncPending()
  }

  /** Open the studio overlay, optionally selecting one project first. */
  open(sessionId?: SessionId): void {
    const current = this.studio.getSnapshot()
    this.studio.set({
      ...current,
      open: true,
      ...(sessionId === undefined ? {} : { activeSessionId: sessionId }),
    })
    if (sessionId !== undefined) this.selectProject(sessionId)
    else if (current.activeSessionId === undefined) {
      const first = this.projects.getSnapshot()[0]
      if (first !== undefined) this.selectProject(first.sessionId)
    }
  }

  /**
   * Surface one already-localized failure message in the studio banner.
   * @param message - localized text a verb's reportError produced.
   */
  fail(message: string): void {
    this.studio.set({ ...this.studio.getSnapshot(), error: message })
  }

  /** Dismiss the studio error banner. */
  clearError(): void {
    const { error: _error, ...rest } = this.studio.getSnapshot()
    this.studio.set(rest)
  }

  /** Close the studio overlay and release the active session binding. */
  close(): void {
    this.setPlaying(false)
    this.studio.set({ ...this.studio.getSnapshot(), open: false })
    this.detach()
    this.project.set(IDLE_PROJECT)
    this.transcript.set(IDLE_TRANSCRIPT)
    this.pendingLive = undefined
    this.pending.set(IDLE_PENDING)
  }

  /**
   * Point the center and right panels at one project.
   * @param sessionId - the project's session identity.
   */
  selectProject(sessionId: SessionId): void {
    const { selectedShotId: _shot, error: _error, ...rest } = this.studio.getSnapshot()
    this.studio.set({ ...rest, activeSessionId: sessionId, playhead: 0, playing: false })
    this.attach(sessionId)
    this.syncPending()
    void this.loadProject(sessionId)
  }

  /**
   * Bring one project up fresh: select it and reload its script and media.
   * @param sessionId - the project's session identity.
   */
  refreshProject(sessionId: SessionId): void {
    this.selectProject(sessionId)
  }

  /**
   * Drop one project from the studio catalog. The session and its files on
   * disk are untouched; the row simply stops being listed.
   * @param sessionId - the project's session identity.
   */
  removeProject(sessionId: SessionId): void {
    this.dismissed.add(sessionId)
    if (this.studio.getSnapshot().activeSessionId === sessionId) {
      this.setPlaying(false)
      const { activeSessionId: _active, selectedShotId: _shot, ...rest } = this.studio.getSnapshot()
      this.studio.set({ ...rest, playhead: 0 })
      this.detach()
      this.project.set(IDLE_PROJECT)
      this.transcript.set(IDLE_TRANSCRIPT)
      this.pendingLive = undefined
      this.pending.set(IDLE_PENDING)
    }
    this.refreshProjects()
  }

  /**
   * Highlight one shot in the preview and timeline.
   * @param shotId - contract shot id.
   */
  selectShot(shotId: string): void {
    this.studio.set({ ...this.studio.getSnapshot(), selectedShotId: shotId })
  }

  /**
   * Move the shared playhead, clamped to the active film's length.
   * @param seconds - position in seconds from the film head.
   */
  setPlayhead(seconds: number): void {
    const total = this.filmSeconds()
    const clamped = Math.min(Math.max(0, seconds), total)
    this.studio.set({ ...this.studio.getSnapshot(), playhead: clamped })
  }

  /**
   * Start or stop the preview clock.
   * @param playing - true to advance the playhead on an interval.
   */
  setPlaying(playing: boolean): void {
    const current = this.studio.getSnapshot()
    if (current.playing === playing) return
    this.studio.set({ ...current, playing })
    if (this.clock !== undefined) {
      clearInterval(this.clock)
      this.clock = undefined
    }
    if (!playing) return
    this.clock = setInterval(() => { this.tick() }, CLOCK_INTERVAL_MS)
  }

  /**
   * Scale the timeline horizontally, clamped to the supported range.
   * @param pxPerSecond - desired pixels per second.
   */
  setZoom(pxPerSecond: number): void {
    const clamped = Math.min(Math.max(MIN_PX_PER_SECOND, pxPerSecond), MAX_PX_PER_SECOND)
    this.studio.set({ ...this.studio.getSnapshot(), pxPerSecond: clamped })
  }

  /**
   * Submit one structured answer batch to the pending ask_user_question,
   * resolving the Host waterfall that the tool is awaiting.
   * @param lines - one answer line per question, in question order.
   */
  async answerQuestion(lines: readonly PendingAnswerLine[]): Promise<void> {
    const pending = this.pendingLive
    if (pending === undefined) return
    this.pendingLive = undefined
    this.pending.set(IDLE_PENDING)
    await pending.answer({ answers: lines.map(line => ({ ...line, selected: [...line.selected] })) })
  }

  /**
   * Run the create-project flow: pick a directory, create a session there,
   * and bind it to the video preset.
   * @param reportError - localizes and surfaces one failure message.
   */
  async createProject(reportError: (message: string) => void): Promise<void> {
    this.clearError()
    this.studio.set({ ...this.studio.getSnapshot(), creating: true })
    try {
      const picked = await this.remote.directoryPicker.pick()
      if (!picked.ok) {
        reportError(failureText(picked))
        return
      }
      if (picked.value === null) return
      const sessionId = await this.sessions.create({ cwd: picked.value })
      const selected = await this.remote.agentPresets.select(sessionId, VIDEO_PRESET_ID)
      if (!selected.ok) reportError(failureText(selected))
      this.open(sessionId)
    } catch (error) {
      reportError(error instanceof Error ? error.message : String(error))
    } finally {
      this.studio.set({ ...this.studio.getSnapshot(), creating: false })
    }
  }

  /**
   * Send one user message to the active project's agent.
   * @param text - message text.
   * @param reportError - localizes and surfaces one failure message.
   */
  async prompt(text: string, reportError: (message: string) => void): Promise<void> {
    const binding = this.reference?.binding
    if (binding === undefined || text.trim().length === 0) return
    this.clearError()
    const result = await binding.session.prompt([{ type: 'text', text }], 'queue')
    if (!result.ok) reportError(failureText(result))
  }

  /** Stop the active project's running turn. */
  async stop(): Promise<void> {
    const binding = this.reference?.binding
    if (binding === undefined) return
    await binding.session.cancel()
  }

  /** Reload the active project's `script.json` and media index. */
  refresh(): void {
    const sessionId = this.studio.getSnapshot().activeSessionId
    if (sessionId !== undefined) void this.loadProject(sessionId)
  }

  /** Release every subscription and reference the controller holds. */
  dispose(): void {
    this.setPlaying(false)
    this.detach()
    this.statusUnsub?.()
    this.statusUnsub = undefined
    this.loadAbort?.abort()
  }

  /** Total length in seconds of the active film, for playhead clamping. */
  private filmSeconds(): number {
    return totalSeconds(shotSpans(this.project.getSnapshot().shots))
  }

  private tick(): void {
    const current = this.studio.getSnapshot()
    const total = this.filmSeconds()
    const next = current.playhead + CLOCK_INTERVAL_MS / 1000
    if (total > 0 && next >= total) {
      this.studio.set({ ...current, playhead: total, playing: false })
      this.setPlaying(false)
      return
    }
    this.studio.set({ ...current, playhead: next })
  }

  private syncPending(): void {
    const sessionId = this.studio.getSnapshot().activeSessionId
    const status = sessionId === undefined
      ? undefined
      : this.uiSession.sessionStatus.getSnapshot().get(sessionId)
    const live = pendingQuestionOf(status?.pendingInteraction)
    this.pendingLive = live
    if (live === undefined) {
      this.pending.set(IDLE_PENDING)
      return
    }
    this.pending.set({
      key: live.key,
      questions: live.questions.map((record, position) => pendingItemOf(record, position)),
    })
  }

  private refreshProjects(): void {
    const list: SessionListState = this.sessions.list.getSnapshot()
    const rows: VideoProjectRow[] = []
    for (const id of list.ids) {
      if (this.dismissed.has(id)) continue
      const summary = list.byId[id]
      if (summary === undefined) continue
      if (summary.parentId !== undefined) continue
      if (summary.projectionValues?.agentPreset !== VIDEO_PRESET_ID) continue
      rows.push({
        sessionId: id,
        title: summary.displayTitle,
        ...(summary.cwd === undefined ? {} : { cwd: summary.cwd }),
        running: summary.running,
        updatedAt: summary.updatedAt,
      })
    }
    rows.sort((left, right) => right.updatedAt - left.updatedAt)
    this.projects.set(rows)
  }

  private attach(sessionId: SessionId): void {
    this.detach()
    const reference = this.sessions.retain(sessionId, { source: 'videoStudio' })
    this.reference = reference
    const binding: SessionBinding = reference.binding
    this.bindingUnsubs.push(binding.eventSource.subscribe(() => { this.refold(binding) }))
    this.bindingUnsubs.push(binding.session.subscribe(() => { this.observeRunning(binding) }))
    this.refold(binding)
    this.observeRunning(binding)
  }

  private detach(): void {
    for (const unsubscribe of this.bindingUnsubs) unsubscribe()
    this.bindingUnsubs = []
    this.reference?.release()
    this.reference = undefined
    this.lastRunning = false
  }

  private refold(binding: SessionBinding): void {
    const eventWindow = binding.eventSource.getSnapshot()
    const entries = foldTranscript(eventWindow.entries)
    const running = binding.session.getSnapshot().running
    this.transcript.set({ entries, running, loaded: eventWindow.revision > 0 || entries.length > 0 })
  }

  private observeRunning(binding: SessionBinding): void {
    const running = binding.session.getSnapshot().running
    const wasRunning = this.lastRunning
    this.lastRunning = running
    this.transcript.set({ ...this.transcript.getSnapshot(), running })
    // A finished turn may have advanced script.json (stage flip, measured
    // durations, media paths); reload once on the running → idle edge.
    if (wasRunning && !running) this.refresh()
  }

  private async loadProject(sessionId: SessionId): Promise<void> {
    this.loadAbort?.abort()
    const abort = new AbortController()
    this.loadAbort = abort
    this.project.set({ status: 'loading', shots: [] })
    const cwd = this.sessions.list.getSnapshot().byId[sessionId]?.cwd
    if (cwd === undefined) {
      this.setProjectIfCurrent(sessionId, abort, { status: 'missing', shots: [] })
      return
    }
    const found = await this.findScript(sessionId, cwd, abort.signal)
    if (abort.signal.aborted) return
    if (found === undefined) {
      this.setProjectIfCurrent(sessionId, abort, { status: 'missing', cwd, shots: [] })
      return
    }
    const parsed = parseScript(found.text)
    if (!parsed.ok) {
      this.setProjectIfCurrent(sessionId, abort, {
        status: 'error', cwd, projectDir: found.dir, error: parsed.error, shots: [],
      })
      return
    }
    const renderPath = await this.findRender(sessionId, found.dir, abort.signal)
    this.setProjectIfCurrent(sessionId, abort, {
      status: 'ready',
      cwd,
      projectDir: found.dir,
      script: parsed.value,
      shots: resolveShots(parsed.value, found.dir),
      ...(renderPath === undefined ? {} : { renderPath }),
    })
  }

  private setProjectIfCurrent(
    sessionId: SessionId,
    abort: AbortController,
    state: ProjectState,
  ): void {
    if (abort.signal.aborted) return
    if (this.studio.getSnapshot().activeSessionId !== sessionId) return
    this.project.set(state)
    if (state.status === 'ready' && this.studio.getSnapshot().selectedShotId === undefined) {
      const first = state.shots[0]
      if (first !== undefined) this.selectShot(first.shot.id)
    }
  }

  /** Read `script.json` at the workspace root, else probe first-level subdirectories. */
  private async findScript(
    sessionId: SessionId,
    cwd: string,
    signal: AbortSignal,
  ): Promise<{ dir: string; text: string } | undefined> {
    const root = await this.readText(sessionId, `${cwd}/script.json`, signal)
    if (root !== undefined) return { dir: cwd, text: root }
    const listing = await this.remote.workspaceFiles.list(sessionId, cwd, signal)
    if (!listing.ok) return undefined
    const directories = listing.value.entries
      .filter(entry => entry.type === 'directory' && !entry.name.startsWith('.'))
      .slice(0, PROJECT_SCAN_LIMIT)
    for (const entry of directories) {
      const dir = `${cwd}/${entry.name}`
      const text = await this.readText(sessionId, `${dir}/script.json`, signal)
      if (text !== undefined) return { dir, text }
    }
    return undefined
  }

  private async readText(
    sessionId: SessionId,
    path: string,
    signal: AbortSignal,
  ): Promise<string | undefined> {
    const result = await this.remote.workspaceFiles.readAll(sessionId, path, signal)
    if (!result.ok) return undefined
    try {
      return decodeBase64Text(result.value.data)
    } catch {
      return undefined
    }
  }

  /** Locate the newest finished render inside the project's `renders/` folder. */
  private async findRender(
    sessionId: SessionId,
    projectDir: string,
    signal: AbortSignal,
  ): Promise<string | undefined> {
    const listing = await this.remote.workspaceFiles.list(sessionId, `${projectDir}/renders`, signal)
    if (!listing.ok) return undefined
    const render = listing.value.entries
      .filter(entry => entry.type === 'file'
        && RENDER_SUFFIXES.some(suffix => entry.name.toLowerCase().endsWith(suffix)))
      .at(-1)
    return render === undefined ? undefined : `${projectDir}/renders/${render.name}`
  }
}
