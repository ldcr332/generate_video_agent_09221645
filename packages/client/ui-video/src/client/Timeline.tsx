/**
 * The editor surface under the preview: one horizontal time ruler over three
 * aligned tracks — subtitles (narration text), picture (shot stills as
 * thumbnails), and audio (per-shot narration waveforms). Every segment is
 * placed on a single seconds axis scaled by `pxPerSecond`, so the ruler ticks,
 * the three tracks, and the draggable playhead stay in register. The playhead
 * is the studio's shared clock: dragging it seeks the preview, and the zoom
 * controls rescale the axis the way a clip editor does.
 */
import { useEffect, useMemo, useRef, useState } from 'react'
import type { ReactNode } from 'react'
import type { TranslateNS } from '@deepseek-ai/dsh-client-ui-slots'
import { Button, IconPlayOutline16, IconPauseOutline16 } from '@deepseek-ai/dsh-client-ui-primitives'
import clsx from 'clsx'
import type { ResolvedShot, ShotSpan } from './script.ts'
import { mediaUrl, shotSpans, totalSeconds } from './script.ts'
import css from './Timeline.module.css'

/** Component inputs assembled by the studio. */
export interface TimelineProps {
  /** Shots in playback order with resolved absolute media paths. */
  readonly shots: readonly ResolvedShot[]
  /** The shot the preview and tracks highlight. */
  readonly selectedShotId?: string
  /** Highlight one shot. */
  readonly onSelectShot: (shotId: string) => void
  /** Playhead position in seconds from the film head. */
  readonly playhead: number
  /** Whether the preview clock is advancing. */
  readonly playing: boolean
  /** Horizontal scale in pixels per second. */
  readonly pxPerSecond: number
  /** Move the shared playhead. */
  readonly onSeek: (seconds: number) => void
  /** Start or stop the preview clock. */
  readonly onTogglePlaying: () => void
  /** Rescale the horizontal axis. */
  readonly onZoom: (pxPerSecond: number) => void
  /** Localized copy. */
  readonly t: TranslateNS<'video'>
}

/** Fixed left gutter width in pixels reserving room for track labels. */
const GUTTER = 72

/** Candidate ruler tick steps in seconds, finest first. */
const TICK_STEPS = [0.5, 1, 2, 5, 10, 15, 30, 60, 120] as const

/** Zoom multiplier applied per click. */
const ZOOM_FACTOR = 1.25

/**
 * Render the ruler and the three aligned tracks.
 * @param props - shots, playhead clock, scale, and verbs.
 * @returns the editor surface, or null when the project has no shots.
 */
export function Timeline({
  shots, selectedShotId, onSelectShot, playhead, playing, pxPerSecond,
  onSeek, onTogglePlaying, onZoom, t,
}: TimelineProps) {
  const spans = useMemo(() => shotSpans(shots), [shots])
  const total = useMemo(() => totalSeconds(spans), [spans])
  const rulerRef = useRef<HTMLDivElement>(null)
  const dragging = useRef(false)

  if (shots.length === 0) return null
  const origin = window.location.origin
  const width = Math.max(1, Math.round(total * pxPerSecond))
  const step = tickStep(pxPerSecond)

  const seekFromPointer = (clientX: number): void => {
    const ruler = rulerRef.current
    if (ruler === null) return
    const rect = ruler.getBoundingClientRect()
    onSeek((clientX - rect.left) / pxPerSecond)
  }

  const ticks: number[] = []
  for (let time = 0; time <= total + 1e-6; time += step) ticks.push(time)

  // Shared placement/selection wiring for every track's segments.
  const segmentProps = {
    spans,
    shots,
    pps: pxPerSecond,
    selectedShotId,
    onSelect: onSelectShot,
    onSeek,
    title: (shotId: string): string => t('timeline.shot', { id: shotId }),
  }

  return (
    <div className={css.timeline}>
      <div className={css.toolbar}>
        <Button
          size="sm"
          variant="ghost"
          icon={playing ? <IconPauseOutline16 /> : <IconPlayOutline16 />}
          onClick={onTogglePlaying}
          title={playing ? t('timeline.pause') : t('timeline.play')}
          aria-label={playing ? t('timeline.pause') : t('timeline.play')}
        />
        <span className={css.clock}>{formatTime(playhead)} / {formatTime(total)}</span>
        <div className={css.zoom}>
          <button
            type="button"
            className={css.zoomButton}
            onClick={() => { onZoom(pxPerSecond / ZOOM_FACTOR) }}
            title={t('timeline.zoom-out')}
            aria-label={t('timeline.zoom-out')}
          >
            −
          </button>
          <button
            type="button"
            className={css.zoomButton}
            onClick={() => { onZoom(pxPerSecond * ZOOM_FACTOR) }}
            title={t('timeline.zoom-in')}
            aria-label={t('timeline.zoom-in')}
          >
            +
          </button>
        </div>
      </div>
      <div className={css.scroll}>
        <div className={css.content} style={{ width: GUTTER + width }}>
          <div className={css.row}>
            <div className={css.gutter} />
            <div
              ref={rulerRef}
              className={css.ruler}
              style={{ width }}
              onPointerDown={(event) => {
                dragging.current = true
                event.currentTarget.setPointerCapture(event.pointerId)
                seekFromPointer(event.clientX)
              }}
              onPointerMove={(event) => {
                if (dragging.current) seekFromPointer(event.clientX)
              }}
              onPointerUp={() => { dragging.current = false }}
              onPointerCancel={() => { dragging.current = false }}
            >
              {ticks.map(time => (
                <span key={time} className={css.tick} style={{ left: time * pxPerSecond }}>
                  <i className={css.tickLine} />
                  <em className={css.tickLabel}>{formatTime(time)}</em>
                </span>
              ))}
            </div>
          </div>
          <Track label={t('timeline.subtitle')}>
            <ShotSegments {...segmentProps}>
              {span => <span className={css.subtitleText}>{span.shot.narration ?? ''}</span>}
            </ShotSegments>
          </Track>
          <Track label={t('timeline.picture')}>
            <ShotSegments {...segmentProps}>
              {(span, resolved) => (resolved?.imagePath === undefined
                ? <span className={css.placeholder}>{span.shot.visual?.summary ?? ''}</span>
                : (
                  <img
                    className={css.thumbnail}
                    src={mediaUrl(origin, resolved.imagePath)}
                    alt={span.shot.visual?.summary ?? span.shot.title ?? span.shot.id}
                    loading="lazy"
                    draggable={false}
                  />
                ))}
            </ShotSegments>
          </Track>
          <Track label={t('timeline.audio')}>
            <ShotSegments {...segmentProps}>
              {(_span, resolved) => (resolved?.audioPath === undefined
                ? <span className={css.placeholder}>{t('timeline.no-audio')}</span>
                : <Waveform src={mediaUrl(origin, resolved.audioPath)} />)}
            </ShotSegments>
          </Track>
          <div className={css.playhead} style={{ left: GUTTER + playhead * pxPerSecond }}>
            <i className={css.playheadHandle} />
          </div>
        </div>
      </div>
    </div>
  )
}

/** One labelled track row sharing the seconds axis. */
function Track({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className={css.row}>
      <div className={css.gutter}><span className={css.trackLabel}>{label}</span></div>
      <div className={css.lane}>{children}</div>
    </div>
  )
}

/**
 * One track's shot segments: placement, selection, and seek wiring shared by
 * all three tracks, with each track supplying only its segment body.
 */
function ShotSegments({
  spans, shots, pps, selectedShotId, onSelect, onSeek, title, children,
}: {
  spans: readonly ShotSpan[]
  shots: readonly ResolvedShot[]
  pps: number
  selectedShotId: string | undefined
  onSelect: (shotId: string) => void
  onSeek: (seconds: number) => void
  title: (shotId: string) => string
  children: (span: ShotSpan, resolved: ResolvedShot | undefined) => ReactNode
}) {
  return spans.map((span) => {
    const resolved = shots.find(candidate => candidate.shot.id === span.shot.id)
    return (
      <Segment
        key={span.shot.id}
        span={span}
        pps={pps}
        selected={span.shot.id === selectedShotId}
        onSelect={onSelect}
        onSeek={onSeek}
        title={title(span.shot.id)}
      >
        {children(span, resolved)}
      </Segment>
    )
  })
}

/** One shot segment absolutely placed on the seconds axis. */
function Segment({
  span, pps, selected, onSelect, onSeek, title, children,
}: {
  span: ShotSpan
  pps: number
  selected: boolean
  onSelect: (shotId: string) => void
  onSeek: (seconds: number) => void
  title: string
  children: ReactNode
}) {
  return (
    <button
      type="button"
      className={clsx(css.segment, selected && css.segmentSelected)}
      style={{ left: span.start * pps, width: Math.max(2, span.duration * pps) }}
      onClick={() => { onSelect(span.shot.id); onSeek(span.start) }}
      title={title}
      aria-label={title}
      aria-pressed={selected}
    >
      {children}
    </button>
  )
}

/** Decode-cache for waveform peaks, keyed by served media URL. */
const peakCache = new Map<string, readonly number[] | null>()

/**
 * One shot's narration waveform, decoded from the served audio clip and drawn
 * as a normalized peak polyline. Decodes are cached per URL.
 */
function Waveform({ src }: { src: string }) {
  const [peaks, setPeaks] = useState<readonly number[] | null | undefined>(
    () => (peakCache.has(src) ? peakCache.get(src) : undefined),
  )
  useEffect(() => {
    let live = true
    // Read through a call so the cleanup's assignment stays visible to checks.
    const alive = (): boolean => live
    if (peakCache.has(src)) {
      setPeaks(peakCache.get(src))
      return () => { live = false }
    }
    void (async () => {
      const computed = await computePeaks(src)
      peakCache.set(src, computed)
      if (alive()) setPeaks(computed)
    })()
    return () => { live = false }
  }, [src])

  if (peaks === undefined) return <span className={css.waveLoading} />
  if (peaks === null || peaks.length === 0) return <span className={css.waveEmpty} />
  const points = peaks
    .map((peak, index) => {
      const x = (index / (peaks.length - 1)) * 100
      const height = Math.max(0.06, peak) * 18
      return `${x.toFixed(2)},${(20 - height).toFixed(2)} ${x.toFixed(2)},${(20 + height).toFixed(2)}`
    })
    .join(' ')
  return (
    <svg className={css.wave} viewBox="0 0 100 40" preserveAspectRatio="none" aria-hidden="true">
      <polyline points={points} fill="none" strokeWidth={1} vectorEffect="non-scaling-stroke" />
    </svg>
  )
}

/**
 * Decode one audio clip and reduce it to normalized peak buckets.
 * @param src - served media URL of the narration clip.
 * @returns 96 peak magnitudes in [0,1], or null when the clip cannot decode.
 */
async function computePeaks(src: string): Promise<readonly number[] | null> {
  try {
    const response = await fetch(src)
    if (!response.ok) return null
    const buffer = await response.arrayBuffer()
    const context = new AudioContext()
    try {
      const audio = await context.decodeAudioData(buffer)
      const channel = audio.getChannelData(0)
      const buckets = 96
      const per = Math.max(1, Math.floor(channel.length / buckets))
      const peaks: number[] = []
      for (let bucket = 0; bucket < buckets; bucket += 1) {
        let max = 0
        const start = bucket * per
        for (let index = start; index < start + per && index < channel.length; index += 1) {
          const magnitude = Math.abs(channel[index] ?? 0)
          if (magnitude > max) max = magnitude
        }
        peaks.push(max)
      }
      const top = Math.max(...peaks, 1e-6)
      return peaks.map(peak => peak / top)
    } finally {
      void context.close()
    }
  } catch {
    return null
  }
}

/**
 * Choose the coarsest ruler tick step whose on-screen spacing stays readable.
 * @param pps - current pixels per second.
 * @returns the tick step in seconds.
 */
function tickStep(pps: number): number {
  for (const candidate of TICK_STEPS) {
    if (candidate * pps >= 64) return candidate
  }
  return TICK_STEPS[TICK_STEPS.length - 1] ?? 120
}

/**
 * Format one seconds offset as a compact ruler/clock label.
 * @param seconds - offset from the film head.
 * @returns `m:ss` above a minute, else whole or tenth seconds.
 */
function formatTime(seconds: number): string {
  const whole = Math.floor(seconds)
  const minutes = Math.floor(whole / 60)
  const rest = whole % 60
  if (minutes > 0) return `${minutes}:${String(rest).padStart(2, '0')}`
  return seconds < 10 && Number.isInteger(seconds) ? String(rest) : `${rest}s`
}
