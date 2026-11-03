/**
 * The studio's center column top: the visual preview. It behaves like a clip
 * player bound to the studio's shared clock — the playhead and play/pause state
 * live in the controller, and this panel follows them. The stage shows the shot
 * the playhead is inside: by default that shot's HyperFrames composition as a
 * live pre-render inside a scaled iframe (the studio-player effect), falling
 * back to the shot still; when the project has a finished render the operator
 * can flip the stage to the film, a `<video>` synced to the same playhead. The
 * column never scrolls: the stage flexes to fill the height left by the header
 * and navigation.
 */
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import type { TranslateNS } from '@deepseek-ai/dsh-client-ui-slots'
import {
  Button, IconRefreshOutline16, IconChevronLeftOutline14, IconChevronRightOutline14,
} from '@deepseek-ai/dsh-client-ui-primitives'
import clsx from 'clsx'
import type { ProjectState } from './controller.ts'
import { mediaUrl, resolveProjectPath, shotSpans } from './script.ts'
import css from './PreviewPanel.module.css'

/** Which media the stage shows when both a composition and a render exist. */
type StageView = 'shot' | 'film'

/** Component inputs assembled by the studio. */
export interface PreviewPanelProps {
  /** Active project load state. */
  readonly project: ProjectState
  /** Shared playhead position in seconds. */
  readonly playhead: number
  /** Whether the shared clock is advancing. */
  readonly playing: boolean
  /** Reload the project's script and media index. */
  readonly onRefresh: () => void
  /** Highlight one shot. */
  readonly onSelectShot: (shotId: string) => void
  /** Move the shared playhead. */
  readonly onSeek: (seconds: number) => void
  /** Localized copy. */
  readonly t: TranslateNS<'video'>
}

/**
 * Render the preview stage and its shot navigation.
 * @param props - project state, shared clock, and verbs.
 * @returns the center column top.
 */
export function PreviewPanel({
  project, playhead, playing, onRefresh, onSelectShot, onSeek, t,
}: PreviewPanelProps) {
  const shots = project.shots
  const spans = useMemo(() => shotSpans(shots), [shots])
  const [view, setView] = useState<StageView>('shot')
  const origin = window.location.origin

  // The shot the playhead sits inside; falls back to the first shot.
  const index = useMemo(() => {
    const found = spans.findIndex(span => playhead < span.start + span.duration)
    return found < 0 ? Math.max(0, spans.length - 1) : found
  }, [spans, playhead])
  const selected = shots[index]
  const hasFilm = project.renderPath !== undefined

  const goto = (next: number): void => {
    const target = spans[next]
    if (target === undefined) return
    onSelectShot(target.shot.id)
    onSeek(target.start)
  }

  return (
    <div className={css.preview}>
      <div className={css.header}>
        <span className={css.heading}>{project.script?.project.title || t('preview.heading')}</span>
        <div className={css.meta}>
          {hasFilm && (
            <div className={css.viewToggle} role="group">
              <button
                type="button"
                className={clsx(css.viewButton, view === 'shot' && css.viewButtonActive)}
                onClick={() => { setView('shot') }}
                aria-pressed={view === 'shot'}
              >
                {t('preview.mode-shot')}
              </button>
              <button
                type="button"
                className={clsx(css.viewButton, view === 'film' && css.viewButtonActive)}
                onClick={() => { setView('film') }}
                aria-pressed={view === 'film'}
              >
                {t('preview.mode-film')}
              </button>
            </div>
          )}
          {project.script?.video.aspectRatio !== undefined && (
            <Chip label={t('preview.meta.ratio')} value={project.script.video.aspectRatio} />
          )}
          {project.script?.totalDurationSeconds != null && (
            <Chip
              label={t('preview.meta.duration')}
              value={t('preview.seconds', { value: Math.round(project.script.totalDurationSeconds) })}
            />
          )}
        </div>
        <Button
          size="sm"
          variant="ghost"
          icon={<IconRefreshOutline16 />}
          onClick={onRefresh}
          title={t('preview.refresh')}
          aria-label={t('preview.refresh')}
        />
      </div>
      <div className={css.stage}>
        <StageBody
          project={project}
          view={view}
          selectedComposition={selected?.shot.visual?.compositionPath}
          selectedImage={selected?.imagePath}
          projectDir={project.projectDir}
          origin={origin}
          playhead={playhead}
          playing={playing}
          t={t}
        />
      </div>
      {project.status === 'ready' && shots.length > 0 && (
        <div className={css.nav}>
          <Button
            size="sm"
            variant="ghost"
            icon={<IconChevronLeftOutline14 />}
            onClick={() => { goto(Math.max(0, index - 1)) }}
            disabled={index <= 0}
            title={t('preview.prev')}
            aria-label={t('preview.prev')}
          />
          <span className={css.counter}>
            {t('preview.shot', { index: index + 1, total: shots.length })}
          </span>
          <Button
            size="sm"
            variant="ghost"
            icon={<IconChevronRightOutline14 />}
            onClick={() => { goto(Math.min(shots.length - 1, index + 1)) }}
            disabled={index >= shots.length - 1}
            title={t('preview.next')}
            aria-label={t('preview.next')}
          />
        </div>
      )}
    </div>
  )
}

/** One read-only metadata chip. */
function Chip({ label, value }: { label: string; value: string }) {
  return (
    <span className={css.chip}>
      <span className={css.chipLabel}>{label}</span>
      {value}
    </span>
  )
}

/**
 * Choose the stage body for one project status, honoring the view toggle and
 * the shared clock.
 * @param props - project state, the selected shot's media, view, and clock facts.
 * @returns the stage node.
 */
function StageBody({
  project, view, selectedComposition, selectedImage, projectDir, origin, playhead, playing, t,
}: {
  project: ProjectState
  view: StageView
  selectedComposition?: string | null | undefined
  selectedImage?: string | undefined
  projectDir?: string | undefined
  origin: string
  playhead: number
  playing: boolean
  t: PreviewPanelProps['t']
}) {
  switch (project.status) {
    case 'loading':
      return <p className={css.note}>{t('preview.loading')}</p>
    case 'error':
      return <p className={css.note}>{t('preview.error', { error: project.error ?? '' })}</p>
    case 'idle':
    case 'missing':
      return (
        <p className={css.note}>
          {project.cwd === undefined ? t('preview.missing') : t('preview.no-script')}
        </p>
      )
    case 'ready':
      if (view === 'film' && project.renderPath !== undefined) {
        return (
          <VideoPlayer
            src={mediaUrl(origin, project.renderPath)}
            playhead={playhead}
            playing={playing}
            label={t('preview.render')}
            loading={t('preview.film-loading')}
          />
        )
      }
      if (selectedComposition != null && projectDir !== undefined) {
        return (
          <CompositionPreview
            projectDir={projectDir}
            compositionPath={selectedComposition}
            origin={origin}
            loading={t('preview.composition-loading')}
            failed={t('preview.composition-missing')}
          />
        )
      }
      if (selectedImage !== undefined) {
        return <img className={css.still} src={mediaUrl(origin, selectedImage)} alt="" />
      }
      if (project.renderPath !== undefined) {
        return (
          <VideoPlayer
            src={mediaUrl(origin, project.renderPath)}
            playhead={playhead}
            playing={playing}
            label={t('preview.render')}
            loading={t('preview.film-loading')}
          />
        )
      }
      return <p className={css.note}>{t('preview.no-script')}</p>
    default:
      return null
  }
}

/**
 * A finished render driven by the shared clock: seeks to the playhead and
 * follows play/pause, so the timeline transport controls the film. The file
 * endpoint serves whole files without byte ranges, which leaves a streamed
 * `<video>` unseekable, so the clip is fetched once into a blob and played from
 * an object URL the playhead can seek freely.
 */
function VideoPlayer({
  src, playhead, playing, label, loading,
}: {
  src: string
  playhead: number
  playing: boolean
  label: string
  loading: string
}) {
  const ref = useRef<HTMLVideoElement>(null)
  const [objectUrl, setObjectUrl] = useState<string | undefined>(undefined)
  useEffect(() => {
    let live = true
    // Read through a call so the cleanup's assignment stays visible to checks.
    const alive = (): boolean => live
    let url: string | undefined
    setObjectUrl(undefined)
    void (async () => {
      try {
        const response = await fetch(src)
        if (!response.ok) return
        const blob = await response.blob()
        if (!alive()) return
        url = URL.createObjectURL(blob)
        setObjectUrl(url)
      } catch {
        // An unreadable render leaves the stage on the loading note.
      }
    })()
    return () => {
      live = false
      if (url !== undefined) URL.revokeObjectURL(url)
    }
  }, [src])
  useEffect(() => {
    const video = ref.current
    if (video === null) return
    if (Math.abs(video.currentTime - playhead) > 0.25) video.currentTime = playhead
  }, [playhead, objectUrl])
  useEffect(() => {
    const video = ref.current
    if (video === null) return
    if (playing) void video.play().catch(() => {})
    else video.pause()
  }, [playing, objectUrl])
  if (objectUrl === undefined) return <p className={css.note}>{loading}</p>
  return (
    <div className={css.player}>
      <span className={css.renderLabel}>{label}</span>
      <video ref={ref} className={css.video} src={objectUrl} preload="auto" playsInline />
    </div>
  )
}

/** Default HyperFrames composition canvas, used when the script omits geometry. */
const CANVAS_WIDTH = 1920
const CANVAS_HEIGHT = 1080

/**
 * A shot's HyperFrames composition rendered before any film exists. The
 * composition HTML is fetched from disk, its `<template>` body extracted, and
 * its relative asset urls rewritten to authenticated `/api/file` urls, then
 * mounted in a borderless iframe scaled to fit the stage.
 */
function CompositionPreview({
  projectDir, compositionPath, origin, loading, failed,
}: {
  projectDir: string
  compositionPath: string
  origin: string
  loading: string
  failed: string
}) {
  const [srcdoc, setSrcdoc] = useState<string | null>(null)
  const [broken, setBroken] = useState(false)
  const absolute = resolveProjectPath(projectDir, compositionPath)

  useEffect(() => {
    let live = true
    // Read through a call so the cleanup's assignment stays visible to checks.
    const alive = (): boolean => live
    setSrcdoc(null)
    setBroken(false)
    if (absolute === undefined) {
      setBroken(true)
      return () => { live = false }
    }
    void (async () => {
      const built = await buildCompositionSrcdoc(origin, projectDir, absolute)
      if (!alive()) return
      if (built === null) setBroken(true)
      else setSrcdoc(built)
    })()
    return () => { live = false }
  }, [origin, projectDir, absolute])

  const fit = useFitScale()
  if (broken) return <p className={css.note}>{failed}</p>
  if (srcdoc === null) return <p className={css.note}>{loading}</p>
  return (
    <div className={css.fit} ref={fit.ref}>
      <div
        className={css.canvas}
        style={{
          width: CANVAS_WIDTH,
          height: CANVAS_HEIGHT,
          transform: `scale(${fit.scale})`,
        }}
      >
        <iframe className={css.frame} title="" srcDoc={srcdoc} sandbox="allow-scripts allow-same-origin" />
      </div>
    </div>
  )
}

/**
 * Fetch one composition file and build a self-contained iframe document: the
 * `<template>` body with relative asset urls rewritten to absolute file urls.
 * @param origin - browser origin for media urls.
 * @param projectDir - absolute directory holding the composition.
 * @param absolute - absolute path of the composition file.
 * @returns the iframe srcdoc, or null when the file cannot be read.
 */
async function buildCompositionSrcdoc(
  origin: string,
  projectDir: string,
  absolute: string,
): Promise<string | null> {
  try {
    const response = await fetch(mediaUrl(origin, absolute))
    if (!response.ok) return null
    const html = await response.text()
    const inner = extractTemplate(html)
    const rewritten = absolutizeUrls(inner, projectDir, origin)
    return '<!doctype html><html><head><meta charset="utf-8"><style>'
      + 'html,body{margin:0;padding:0;background:#000;overflow:hidden;width:100%;height:100%}'
      + `</style></head><body>${rewritten}</body></html>`
  } catch {
    return null
  }
}

/**
 * Pull the inner HTML of the composition's first `<template>`, falling back to
 * the whole document when no template wrapper is present.
 * @param html - raw composition source.
 * @returns the markup to mount.
 */
function extractTemplate(html: string): string {
  const match = /<template[^>]*>([\s\S]*?)<\/template>/i.exec(html)
  return match?.[1] ?? html
}

/**
 * Rewrite relative asset references to authenticated absolute file urls.
 * @param markup - composition inner HTML.
 * @param projectDir - directory relative paths resolve against.
 * @param origin - browser origin for media urls.
 * @returns markup with every resolvable relative url made absolute.
 */
function absolutizeUrls(markup: string, projectDir: string, origin: string): string {
  const rewrite = (value: string): string => {
    if (/^(https?:|data:|blob:|\/|#)/i.test(value)) return value
    const absolute = resolveProjectPath(projectDir, value)
    return absolute === undefined ? value : mediaUrl(origin, absolute)
  }
  return markup
    .replace(/url\(\s*(['"]?)([^'")]+)\1\s*\)/gi, (whole, quote: string, path: string) => {
      const next = rewrite(path.trim())
      return next === path ? whole : `url(${quote}${next}${quote})`
    })
    .replace(/\b(src|href)=(['"])([^'"]+)\2/gi, (whole, attr: string, quote: string, path: string) => {
      const next = rewrite(path.trim())
      return next === path ? whole : `${attr}=${quote}${next}${quote}`
    })
}

/**
 * Track one element's box and report the scale that fits the fixed canvas
 * inside it, preserving aspect ratio. The box only exists once the iframe
 * source is ready, so the observer attaches through a callback ref.
 * @returns the container ref and the current fit scale.
 */
function useFitScale(): { ref: (node: HTMLDivElement | null) => void; scale: number } {
  const [scale, setScale] = useState(0.2)
  const observerRef = useRef<ResizeObserver | null>(null)
  const ref = useCallback((node: HTMLDivElement | null) => {
    observerRef.current?.disconnect()
    observerRef.current = null
    if (node === null) return
    const measure = (): void => {
      // clientWidth/Height are layout pixels, independent of any page zoom.
      const { clientWidth, clientHeight } = node
      if (clientWidth === 0 || clientHeight === 0) return
      setScale(Math.min(clientWidth / CANVAS_WIDTH, clientHeight / CANVAS_HEIGHT))
    }
    measure()
    const observer = new ResizeObserver(measure)
    observer.observe(node)
    observerRef.current = observer
  }, [])
  useEffect(() => () => { observerRef.current?.disconnect() }, [])
  return { ref, scale }
}
