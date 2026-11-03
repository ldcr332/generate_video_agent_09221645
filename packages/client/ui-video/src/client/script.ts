/**
 * `script.json` contract parsing and shot media resolution.
 *
 * The video-production skill owns the file's field contract; this module is
 * the browser-side reader. Every field arrives from a file on disk, so the
 * parse is a wire-boundary validation: unknown shapes fall back to absent
 * optional fields instead of throwing, and a file without a shots array is
 * rejected with a message the preview panel shows verbatim.
 */

/** One shot's visual plan, mirroring the skill's `shots[].visual` object. */
export interface VideoScriptShotVisual {
  /** Visual kind the skill defines (`html`, `image`, …); free-form for forward compatibility. */
  readonly kind?: string | undefined
  /** Human summary of the shot's picture. */
  readonly summary?: string | null | undefined
  /** Prompt used for a generated still, when one was requested. */
  readonly imagePrompt?: string | null | undefined
  /** Project-relative path of the generated still. */
  readonly imagePath?: string | null | undefined
  /** Project-relative path of the shot's composition file. */
  readonly compositionPath?: string | null | undefined
}

/** One 分镜 entry of the script contract. */
export interface VideoScriptShot {
  /** Stable zero-padded shot id naming the shot's files. */
  readonly id: string
  /** 1-based playback position. */
  readonly index: number
  /** Shot title. */
  readonly title?: string | undefined
  /** Narration text spoken over the shot. */
  readonly narration?: string | undefined
  /** Project-relative path of the narration audio clip. */
  readonly narrationAudio?: string | null | undefined
  /** Measured shot duration in seconds; null until stage 2 measures it. */
  readonly durationSeconds?: number | null | undefined
  /** Visual plan for the shot. */
  readonly visual?: VideoScriptShotVisual | undefined
  /** Transition into the next shot. */
  readonly transition?: string | undefined
  /** Free-form production notes. */
  readonly notes?: string | undefined
}

/** The parsed `script.json` contract. */
export interface VideoScript {
  /** Schema version. */
  readonly version: number
  /** Project identity. */
  readonly project: {
    /** Project folder name. */
    readonly id: string
    /** Human title of the video. */
    readonly title: string
    /** ISO-8601 creation time. */
    readonly createdAt?: string | undefined
    /** ISO-8601 last-write time. */
    readonly updatedAt?: string | undefined
  }
  /** Composition geometry. */
  readonly video: {
    /** Composition pixel width. */
    readonly width?: number | undefined
    /** Composition pixel height. */
    readonly height?: number | undefined
    /** Render frame rate. */
    readonly fps?: number | undefined
    /** Aspect-ratio label such as `16:9`. */
    readonly aspectRatio?: string | undefined
    /** BCP-47 narration language. */
    readonly language?: string | undefined
  }
  /** Furthest completed production stage. */
  readonly stage: string
  /** Sum of shot durations; null until stage 2. */
  readonly totalDurationSeconds: number | null
  /** Shots ordered by index. */
  readonly shots: readonly VideoScriptShot[]
}

/** Outcome of one `script.json` parse. */
export type ScriptParseResult =
  | { readonly ok: true; readonly value: VideoScript }
  | { readonly ok: false; readonly error: string }

function stringOf(value: unknown): string | undefined {
  return typeof value === 'string' ? value : undefined
}

function numberOf(value: unknown): number | undefined {
  return typeof value === 'number' && Number.isFinite(value) ? value : undefined
}

function nullableNumberOf(value: unknown): number | null | undefined {
  if (value === null) return null
  return numberOf(value)
}

function recordOf(value: unknown): Record<string, unknown> | undefined {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
    ? value as Record<string, unknown>
    : undefined
}

function parseVisual(value: unknown): VideoScriptShotVisual | undefined {
  const visual = recordOf(value)
  if (visual === undefined) return undefined
  return {
    kind: stringOf(visual.kind),
    summary: visual.summary === undefined ? undefined : stringOf(visual.summary) ?? null,
    imagePrompt: visual.imagePrompt === undefined ? undefined : stringOf(visual.imagePrompt) ?? null,
    imagePath: visual.imagePath === undefined ? undefined : stringOf(visual.imagePath) ?? null,
    compositionPath: visual.compositionPath === undefined
      ? undefined
      : stringOf(visual.compositionPath) ?? null,
  }
}

function parseShot(value: unknown, position: number): VideoScriptShot | undefined {
  const shot = recordOf(value)
  if (shot === undefined) return undefined
  const id = stringOf(shot.id) ?? `shot-${String(position + 1).padStart(2, '0')}`
  return {
    id,
    index: numberOf(shot.index) ?? position + 1,
    title: stringOf(shot.title),
    narration: stringOf(shot.narration),
    narrationAudio: shot.narrationAudio === undefined ? undefined : stringOf(shot.narrationAudio) ?? null,
    durationSeconds: shot.durationSeconds === undefined ? undefined : nullableNumberOf(shot.durationSeconds),
    visual: parseVisual(shot.visual),
    transition: stringOf(shot.transition),
    notes: stringOf(shot.notes),
  }
}

/**
 * Parse and validate one `script.json` text.
 * @param text - complete file content.
 * @returns the parsed contract, or the rejection reason to display.
 */
export function parseScript(text: string): ScriptParseResult {
  let root: unknown
  try {
    root = JSON.parse(text)
  } catch {
    return { ok: false, error: 'script.json is not valid JSON' }
  }
  const value = recordOf(root)
  if (value === undefined) return { ok: false, error: 'script.json must be a JSON object' }
  const shotsRaw = value.shots
  if (!Array.isArray(shotsRaw)) return { ok: false, error: 'script.json has no shots array' }
  const shots = shotsRaw
    .map((entry, position) => parseShot(entry, position))
    .filter((shot): shot is VideoScriptShot => shot !== undefined)
    .sort((left, right) => left.index - right.index)
  const project = recordOf(value.project)
  const video = recordOf(value.video)
  return {
    ok: true,
    value: {
      version: numberOf(value.version) ?? 1,
      project: {
        id: stringOf(project?.id) ?? '',
        title: stringOf(project?.title) ?? '',
        createdAt: stringOf(project?.createdAt),
        updatedAt: stringOf(project?.updatedAt),
      },
      video: {
        width: numberOf(video?.width),
        height: numberOf(video?.height),
        fps: numberOf(video?.fps),
        aspectRatio: stringOf(video?.aspectRatio),
        language: stringOf(video?.language),
      },
      stage: stringOf(value.stage) ?? 'script',
      totalDurationSeconds: value.totalDurationSeconds === undefined
        ? null
        : nullableNumberOf(value.totalDurationSeconds) ?? null,
      shots,
    },
  }
}

/** One shot with its media references resolved to absolute host paths. */
export interface ResolvedShot {
  /** Contract shot this row resolves. */
  readonly shot: VideoScriptShot
  /** Absolute path of the shot still, when the script names one. */
  readonly imagePath?: string
  /** Absolute path of the narration clip, when the script names one. */
  readonly audioPath?: string
}

/**
 * Join one project-relative script path onto the project directory.
 * @param projectDir - absolute project directory.
 * @param relative - forward-slashed relative path from `script.json`.
 * @returns the absolute path, or undefined for blank or absolute inputs.
 */
export function resolveProjectPath(projectDir: string, relative: string): string | undefined {
  const trimmed = relative.trim()
  if (trimmed.length === 0 || trimmed.startsWith('/') || /^[a-z][a-z\d+.-]*:/iu.test(trimmed)) {
    return undefined
  }
  const segments = trimmed.split('/').filter(segment => segment.length > 0 && segment !== '.')
  if (segments.includes('..')) return undefined
  return `${projectDir.replace(/\/+$/, '')}/${segments.join('/')}`
}

/**
 * Resolve every shot's media references against the project directory.
 * @param script - parsed contract.
 * @param projectDir - absolute directory containing `script.json`.
 * @returns shots in playback order with absolute media paths where declared.
 */
export function resolveShots(script: VideoScript, projectDir: string): readonly ResolvedShot[] {
  return script.shots.map((shot) => {
    const imagePath = shot.visual?.imagePath == null
      ? undefined
      : resolveProjectPath(projectDir, shot.visual.imagePath)
    const audioPath = shot.narrationAudio == null
      ? undefined
      : resolveProjectPath(projectDir, shot.narrationAudio)
    return {
      shot,
      ...(imagePath === undefined ? {} : { imagePath }),
      ...(audioPath === undefined ? {} : { audioPath }),
    }
  })
}

/** One shot laid out on the time axis: its playback start and span in seconds. */
export interface ShotSpan {
  /** The shot this span places. */
  readonly shot: ResolvedShot['shot']
  /** Playback start offset in seconds from the film head. */
  readonly start: number
  /** Span length in seconds; a placeholder before stage 2 measures it. */
  readonly duration: number
}

/** Seconds assigned to a shot whose duration stage 2 has not measured yet. */
export const UNMEASURED_SHOT_SECONDS = 4

/**
 * Lay shots out contiguously on the time axis so the ruler, tracks, and
 * playhead share one clock. Unmeasured shots get a uniform placeholder span.
 * @param shots - shots in playback order.
 * @returns one span per shot with cumulative start offsets.
 */
export function shotSpans(shots: readonly ResolvedShot[]): readonly ShotSpan[] {
  const spans: ShotSpan[] = []
  let cursor = 0
  for (const resolved of shots) {
    const measured = resolved.shot.durationSeconds
    const duration = measured !== null && measured !== undefined && measured > 0
      ? measured
      : UNMEASURED_SHOT_SECONDS
    spans.push({ shot: resolved.shot, start: cursor, duration })
    cursor += duration
  }
  return spans
}

/**
 * Total film length implied by a span layout.
 * @param spans - contiguous shot spans.
 * @returns seconds from head to the last span's end.
 */
export function totalSeconds(spans: readonly ShotSpan[]): number {
  const last = spans[spans.length - 1]
  return last === undefined ? 0 : last.start + last.duration
}

/**
 * Build the same-origin file-API URL serving one absolute host path.
 * @param origin - `window.location.origin` at call time.
 * @param absolutePath - absolute host file path.
 * @returns the authenticated `/api/file` URL the browser can load directly.
 */
export function mediaUrl(origin: string, absolutePath: string): string {
  return `${origin}/api/file?path=${encodeURIComponent(absolutePath)}`
}
