/**
 * Video-studio surface plugin, browser half. One controller owns the studio's
 * state and verbs; three registrations expose it: a full-screen studio on
 * `shell.overlay`, and a mode toggle on both the sidebar foot and the session
 * header utilities so the switch is reachable whether or not a conversation is
 * open. The package adds no Host surface — every fact arrives from `ctx.sessions`,
 * `ctx.remote`, and `ctx.uiSession`.
 */
import type { Context as ClientContext } from '@deepseek-ai/cordis'
import type { SessionId } from '@deepseek-ai/dsh-session/types'
// Type-only: pulls the ctx.sessions service merge and the reference-source map.
import type {} from '@deepseek-ai/dsh-api-session-controller/client'
// Type-only: pulls the ctx.remote merge and each namespace this studio calls.
import type {} from '@deepseek-ai/dsh-api-remotes/client'
import type {} from '@deepseek-ai/dsh-api-workspace-files/remote'
import type {} from '@deepseek-ai/dsh-api-workspace-controller/remote'
import type {} from '@deepseek-ai/dsh-agent-presets/remote'
// Type-only: pulls the ctx.locale merge and the LocaleNamespaceMap this file extends.
import type {} from '@deepseek-ai/dsh-client-locale/client'
import type {} from '@deepseek-ai/dsh-client-ui-slots'
import type {} from '@deepseek-ai/dsh-client-ui-renderer/client'
// Type-only: pulls each SlotMap merge this studio registers into.
import type {} from '@deepseek-ai/dsh-client-ui-layout/client'
import type {} from '@deepseek-ai/dsh-client-ui-sidebar/client'
import type {} from '@deepseek-ai/dsh-client-ui-conversation/client'
import type {} from '@deepseek-ai/dsh-client-ui-session/client'
import { VideoStudioController } from './controller.ts'
import { VideoStudio } from './VideoStudio.tsx'
import type { StudioInjected } from './VideoStudio.tsx'
import { ModeToggle } from './ModeToggle.tsx'
import type { ModeToggleInjected } from './ModeToggle.tsx'
import { en, zh, type VideoKey } from './locales.ts'

declare module '@deepseek-ai/dsh-client-ui-slots' {
  interface LocaleNamespaceMap {
    /** Video-studio copy. */
    video: VideoKey
  }
}

declare module '@deepseek-ai/dsh-api-session-controller/client' {
  interface SessionReferenceSourceMap {
    /** The studio's hold on the active project session. */
    videoStudio: unknown
  }
}

export type {
  ProjectState, StudioState, TranscriptState, VideoProjectRow, VideoStudioController,
  PendingQuestionView, PendingQuestionItem, PendingQuestionOption, PendingAnswerLine,
} from './controller.ts'
export { VIDEO_PRESET_ID } from './controller.ts'
export type { StudioInjected, VideoStudioProps } from './VideoStudio.tsx'
export type { ModeToggleInjected, ModeToggleProps } from './ModeToggle.tsx'
export type { ProjectListProps } from './ProjectList.tsx'
export type { PreviewPanelProps } from './PreviewPanel.tsx'
export type { TimelineProps } from './Timeline.tsx'
export type { ChatPanelProps } from './ChatPanel.tsx'
export type {
  ResolvedShot, VideoScript, VideoScriptShot, VideoScriptShotVisual,
} from './script.ts'
export { parseScript, resolveShots, resolveProjectPath, mediaUrl } from './script.ts'
export type {
  TranscriptEntry, TranscriptStep, TranscriptToolStep, TranscriptEventEntry,
} from './transcript.ts'
export { foldTranscript } from './transcript.ts'
export { en, zh, type VideoKey } from './locales.ts'

/** Required services (cordis fiber inject). */
export const inject = [
  'slots', 'sessions', 'locale', 'remote', 'uiSession',
  'remote.workspaceFiles', 'remote.directoryPicker', 'remote.agentPresets',
]

/**
 * Mount the video studio and its mode toggles.
 * @param ctx - the browser plugin context.
 */
export function apply(ctx: ClientContext): void {
  const controller = new VideoStudioController(ctx.sessions, ctx.remote, ctx.uiSession)
  ctx.effect(() => ctx.locale.register('video', { zh, en }), 'ui-video: dictionaries')
  ctx.effect(() => () => { controller.dispose() }, 'ui-video: controller lifetime')

  // Localize at report time so the dictionary is registered before first use.
  const reportCreate = (message: string): void => {
    controller.fail(ctx.locale.bind('video')('error.create-failed', { error: message }))
  }
  const reportPrompt = (message: string): void => {
    controller.fail(ctx.locale.bind('video')('error.prompt-failed', { error: message }))
  }

  const toggle = (): void => {
    if (controller.studio.getSnapshot().open) controller.close()
    else controller.open()
  }
  const modeToggleInjected = (): ModeToggleInjected => ({
    hooks: { studio: controller.studio },
    toggle,
  })

  ctx.slots.inject('shell.overlay', () => ctx.slots.register({
    name: 'shell.overlay',
    id: 'video-studio',
    locale: 'video',
    inject: (): StudioInjected => ({
      hooks: {
        studio: controller.studio,
        projects: controller.projects,
        project: controller.project,
        transcript: controller.transcript,
        pending: controller.pending,
      },
      selectProject: (sessionId: SessionId) =>{  controller.selectProject(sessionId) },
      selectShot: (shotId: string) =>{  controller.selectShot(shotId) },
      createProject: () => { void controller.createProject(reportCreate) },
      prompt: (text: string) => { void controller.prompt(text, reportPrompt) },
      stop: () => { void controller.stop() },
      refresh: () =>{  controller.refresh() },
      refreshProject: (sessionId: SessionId) =>{  controller.refreshProject(sessionId) },
      removeProject: (sessionId: SessionId) =>{  controller.removeProject(sessionId) },
      seek: (seconds: number) =>{  controller.setPlayhead(seconds) },
      togglePlaying: () =>{  controller.setPlaying(!controller.studio.getSnapshot().playing) },
      zoom: (pxPerSecond: number) =>{  controller.setZoom(pxPerSecond) },
      answer: (lines) => { void controller.answerQuestion(lines) },
      close: () =>{  controller.close() },
      clearError: () =>{  controller.clearError() },
    }),
  }, VideoStudio))

  ctx.slots.inject('sidebar.footer.action', () => ctx.slots.register({
    name: 'sidebar.footer.action',
    id: 'video-mode',
    order: 50,
    locale: 'video',
    inject: modeToggleInjected,
  }, ModeToggle))

  ctx.slots.inject('conversation.session.header.utilities', () => ctx.slots.register({
    name: 'conversation.session.header.utilities',
    id: 'video-mode',
    order: 50,
    locale: 'video',
    inject: modeToggleInjected,
  }, ModeToggle))
}
