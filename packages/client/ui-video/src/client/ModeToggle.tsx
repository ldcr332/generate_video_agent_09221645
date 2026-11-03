/**
 * The video-studio entry control. Registered into the sidebar foot (always
 * present) and the session header utilities (the top area beside an open
 * conversation); both seats drive the one studio overlay through the shared
 * controller. The rail-narrow sidebar seat passes `wide: false` and collapses
 * to an icon-only button.
 */
import type { SnapshotStore } from '@deepseek-ai/dsh-client-store'
import type { InjectFace, PropsLocale } from '@deepseek-ai/dsh-client-ui-slots'
import { Button, IconSparkle16 } from '@deepseek-ai/dsh-client-ui-primitives'
import type { StudioState } from './controller.ts'
import css from './ModeToggle.module.css'

/** Registration-side face for the mode toggle. */
export interface ModeToggleInjected {
  hooks: {
    /** Studio view state, bound by the renderer as useStudio. */
    studio: SnapshotStore<StudioState>
  }
  /** Flip the studio overlay open or closed. */
  toggle: () => void
}

/** Full component props; `wide` is present only on the sidebar foot seat. */
export type ModeToggleProps =
  InjectFace<ModeToggleInjected>
  & PropsLocale<'video'>
  & { readonly wide?: boolean }

/**
 * Render the default-view / video-mode switch.
 * @param props - composed slot props.
 * @returns the toggle button.
 */
export function ModeToggle({ useStudio, toggle, t, wide = true }: ModeToggleProps) {
  const open = useStudio(state => state.open)
  const label = open ? t('toggle.close') : t('toggle.open')
  return (
    <Button
      className={css.toggle}
      variant={open ? 'primary' : 'ghost'}
      size="sm"
      icon={<IconSparkle16 />}
      onClick={toggle}
      title={label}
      aria-label={t('toggle.aria')}
      aria-pressed={open}
    >
      {wide && <span className={css.label}>{label}</span>}
    </Button>
  )
}
