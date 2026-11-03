/**
 * The full-screen video-studio overlay. Registered into `shell.overlay`, so it
 * covers the default client while open and renders nothing while closed. It is
 * the only slot occupant in the package: the three columns — project catalog,
 * preview over timeline, and agent chat — are plain components this occupant
 * composes, reading the shared controller through bound selector hooks.
 */
import type { SessionId } from '@deepseek-ai/dsh-session/types'
import type { SnapshotStore } from '@deepseek-ai/dsh-client-store'
import type { InjectFace, PropsLocale } from '@deepseek-ai/dsh-client-ui-slots'
import { Button, IconCloseOutline16 } from '@deepseek-ai/dsh-client-ui-primitives'
import type {
  PendingAnswerLine, PendingQuestionView, ProjectState, StudioState, TranscriptState,
  VideoProjectRow,
} from './controller.ts'
import { ProjectList } from './ProjectList.tsx'
import { PreviewPanel } from './PreviewPanel.tsx'
import { Timeline } from './Timeline.tsx'
import { ChatPanel } from './ChatPanel.tsx'
import css from './VideoStudio.module.css'

/** Registration-side face for the studio overlay. */
export interface StudioInjected {
  hooks: {
    /** Studio view state, bound as useStudio. */
    studio: SnapshotStore<StudioState>
    /** Project catalog rows, bound as useProjects. */
    projects: SnapshotStore<readonly VideoProjectRow[]>
    /** Active project detail, bound as useProject. */
    project: SnapshotStore<ProjectState>
    /** Active transcript, bound as useTranscript. */
    transcript: SnapshotStore<TranscriptState>
    /** Active pending ask_user_question, bound as usePending. */
    pending: SnapshotStore<PendingQuestionView>
  }
  /** Point the center and right panels at one project. */
  selectProject: (sessionId: SessionId) => void
  /** Highlight one shot. */
  selectShot: (shotId: string) => void
  /** Start the pick-directory create flow. */
  createProject: () => void
  /** Queue one user message to the active project's agent. */
  prompt: (text: string) => void
  /** Cancel the active project's running turn. */
  stop: () => void
  /** Reload the active project's script and media. */
  refresh: () => void
  /** Reload one project and bring it up. */
  refreshProject: (sessionId: SessionId) => void
  /** Drop one project from the catalog. */
  removeProject: (sessionId: SessionId) => void
  /** Move the shared playhead. */
  seek: (seconds: number) => void
  /** Start or stop the shared preview clock. */
  togglePlaying: () => void
  /** Rescale the timeline's horizontal axis. */
  zoom: (pxPerSecond: number) => void
  /** Submit one structured answer batch to the pending question. */
  answer: (lines: readonly PendingAnswerLine[]) => void
  /** Close the overlay and release the active binding. */
  close: () => void
  /** Dismiss the error banner. */
  clearError: () => void
}

/** Full component props. */
export type VideoStudioProps = InjectFace<StudioInjected> & PropsLocale<'video'>

/**
 * Render the studio overlay, or nothing while it is closed.
 * @param props - composed slot props.
 * @returns the full-screen three-column studio, or null.
 */
export function VideoStudio({
  useStudio, useProjects, useProject, useTranscript, usePending,
  selectProject, selectShot, createProject, prompt, stop, refresh,
  refreshProject, removeProject, seek, togglePlaying, zoom, answer, close, clearError, t,
}: VideoStudioProps) {
  const studio = useStudio(state => state)
  const projects = useProjects(rows => rows)
  const project = useProject(state => state)
  const transcript = useTranscript(state => state)
  const pending = usePending(state => state)
  if (!studio.open) return null
  return (
    <div className={css.studio}>
      <div className={css.topbar}>
        <span className={css.title}>{t('studio.title')}</span>
        <Button
          className={css.exit}
          size="sm"
          variant="ghost"
          icon={<IconCloseOutline16 />}
          onClick={close}
        >
          {t('studio.exit')}
        </Button>
      </div>
      {studio.error !== undefined && (
        <div className={css.error} role="alert">
          <span>{studio.error}</span>
          <button type="button" className={css.errorClose} onClick={clearError} aria-label={t('studio.exit')}>
            <IconCloseOutline16 />
          </button>
        </div>
      )}
      <div className={css.columns}>
        <div className={css.left}>
          <ProjectList
            rows={projects}
            {...(studio.activeSessionId === undefined ? {} : { activeSessionId: studio.activeSessionId })}
            creating={studio.creating}
            onSelect={selectProject}
            onRefresh={refreshProject}
            onRemove={removeProject}
            onCreate={createProject}
            t={t}
          />
        </div>
        <div className={css.center}>
          <PreviewPanel
            project={project}
            playhead={studio.playhead}
            playing={studio.playing}
            onSelectShot={selectShot}
            onSeek={seek}
            onRefresh={refresh}
            t={t}
          />
          <Timeline
            shots={project.shots}
            {...(studio.selectedShotId === undefined ? {} : { selectedShotId: studio.selectedShotId })}
            onSelectShot={selectShot}
            playhead={studio.playhead}
            playing={studio.playing}
            pxPerSecond={studio.pxPerSecond}
            onSeek={seek}
            onTogglePlaying={togglePlaying}
            onZoom={zoom}
            t={t}
          />
        </div>
        <div className={css.right}>
          <ChatPanel
            transcript={transcript}
            pending={pending}
            onSend={prompt}
            onStop={stop}
            onAnswer={answer}
            t={t}
          />
        </div>
      </div>
    </div>
  )
}
