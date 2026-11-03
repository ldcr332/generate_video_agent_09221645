/**
 * The studio's left column: the hyperframes project catalog. Rows are the
 * sessions running the video preset, newest first; selecting one points the
 * preview and chat panels at it. Each row carries its own refresh (reload and
 * bring up) and remove (drop from the catalog) verbs beside the select
 * affordance. This is a plain component the studio composes — it reads no slot
 * props and holds no state of its own.
 */
import type { SessionId } from '@deepseek-ai/dsh-session/types'
import type { TranslateNS } from '@deepseek-ai/dsh-client-ui-slots'
import {
  Button, IconPlusOutline16, IconLoadingOutline16, IconRefreshOutline16, IconTrashOutline16,
} from '@deepseek-ai/dsh-client-ui-primitives'
import clsx from 'clsx'
import type { VideoProjectRow } from './controller.ts'
import css from './ProjectList.module.css'

/** Component inputs assembled by the studio. */
export interface ProjectListProps {
  /** Catalog rows in display order. */
  readonly rows: readonly VideoProjectRow[]
  /** The row the center and right panels follow. */
  readonly activeSessionId?: SessionId
  /** Whether a create flow is in flight. */
  readonly creating: boolean
  /** Point the studio at one project. */
  readonly onSelect: (sessionId: SessionId) => void
  /** Reload one project and bring it up. */
  readonly onRefresh: (sessionId: SessionId) => void
  /** Drop one project from the catalog. */
  readonly onRemove: (sessionId: SessionId) => void
  /** Start the pick-directory create flow. */
  readonly onCreate: () => void
  /** Localized copy. */
  readonly t: TranslateNS<'video'>
}

/**
 * Render the project catalog column.
 * @param props - catalog rows, selection, and verbs.
 * @returns the left column.
 */
export function ProjectList({
  rows, activeSessionId, creating, onSelect, onRefresh, onRemove, onCreate, t,
}: ProjectListProps) {
  return (
    <div className={css.list}>
      <div className={css.header}>
        <span className={css.heading}>{t('projects.heading')}</span>
        <Button
          size="sm"
          variant="ghost"
          icon={creating ? <IconLoadingOutline16 /> : <IconPlusOutline16 />}
          onClick={onCreate}
          disabled={creating}
          title={t('projects.new')}
          aria-label={t('projects.new')}
        />
      </div>
      {rows.length === 0
        ? <p className={css.empty}>{t('projects.empty')}</p>
        : (
          <ul className={css.rows}>
            {rows.map(row => (
              <li key={row.sessionId}>
                <div
                  className={clsx(css.row, row.sessionId === activeSessionId && css.active)}
                  role="button"
                  tabIndex={0}
                  onClick={() => { onSelect(row.sessionId) }}
                  onKeyDown={(event) => {
                    if (event.key === 'Enter' || event.key === ' ') {
                      event.preventDefault()
                      onSelect(row.sessionId)
                    }
                  }}
                >
                  <span className={css.title}>{row.title}</span>
                  <span className={css.rowActions}>
                    {row.running && (
                      <span className={css.running}>
                        <IconLoadingOutline16 />
                      </span>
                    )}
                    <button
                      type="button"
                      className={css.rowButton}
                      onClick={(event) => { event.stopPropagation(); onRefresh(row.sessionId) }}
                      title={t('projects.refresh')}
                      aria-label={t('projects.refresh')}
                    >
                      <IconRefreshOutline16 />
                    </button>
                    <button
                      type="button"
                      className={clsx(css.rowButton, css.rowButtonDanger)}
                      onClick={(event) => { event.stopPropagation(); onRemove(row.sessionId) }}
                      title={t('projects.remove')}
                      aria-label={t('projects.remove')}
                    >
                      <IconTrashOutline16 />
                    </button>
                  </span>
                </div>
              </li>
            ))}
          </ul>
        )}
    </div>
  )
}
