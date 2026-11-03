/**
 * The studio's right column: the agent conversation. User and closing-assistant
 * turns render as markdown bubbles; each turn's intermediate tool calls,
 * reasoning, and partial text fold into one collapsible process row that stays
 * open while the turn runs and collapses once it settles — the default
 * conversation's collapse-on-finish behavior. When the agent awaits an
 * ask_user_question, the pending batch renders here as numbered option cards
 * with a number entry to continue, never as raw tool JSON. The composer queues
 * a video request or stops the running turn. Plain component; the studio
 * composes it.
 */
import { useEffect, useMemo, useState } from 'react'
import type { TranslateNS } from '@deepseek-ai/dsh-client-ui-slots'
import {
  MarkdownText, DisclosureRow, Button,
  IconSendOutline14, IconStopFill16, IconThinkOutline16, IconCodeOutline16,
} from '@deepseek-ai/dsh-client-ui-primitives'
import type { MarkdownLabels } from '@deepseek-ai/dsh-client-ui-primitives'
import clsx from 'clsx'
import type { PendingAnswerLine, PendingQuestionView, TranscriptState } from './controller.ts'
import type { TranscriptEntry, TranscriptProcessEntry, TranscriptStep } from './transcript.ts'
import css from './ChatPanel.module.css'

/** Tool whose arguments are rendered as question cards instead of raw JSON. */
const ASK_TOOL = 'ask_user_question'

/** Component inputs assembled by the studio. */
export interface ChatPanelProps {
  /** Folded transcript and running flag of the active session. */
  readonly transcript: TranscriptState
  /** The active session's pending ask_user_question, empty when none. */
  readonly pending: PendingQuestionView
  /** Queue one user message. */
  readonly onSend: (text: string) => void
  /** Cancel the running turn. */
  readonly onStop: () => void
  /** Submit one structured answer batch to the pending question. */
  readonly onAnswer: (lines: readonly PendingAnswerLine[]) => void
  /** Localized copy. */
  readonly t: TranslateNS<'video'>
}

/**
 * Render the conversation column.
 * @param props - transcript, pending question, verbs, and localized copy.
 * @returns the right column.
 */
export function ChatPanel({ transcript, pending, onSend, onStop, onAnswer, t }: ChatPanelProps) {
  const [draft, setDraft] = useState('')
  const labels = useMemo<MarkdownLabels>(() => ({
    code: { copyLabel: t('markdown.copy'), copiedLabel: t('markdown.copied') },
    footnotes: t('markdown.footnotes'),
  }), [t])

  const send = (): void => {
    const text = draft.trim()
    if (text.length === 0) return
    onSend(text)
    setDraft('')
  }

  const hasPending = pending.questions.length > 0

  return (
    <div className={css.chat}>
      <div className={css.header}>{t('chat.heading')}</div>
      <div className={css.scroll}>
        {transcript.entries.length === 0
          ? <p className={css.empty}>{t('chat.empty')}</p>
          : transcript.entries.map(entry => (
            <Bubble key={entry.id} entry={entry} labels={labels} t={t} />
          ))}
        {hasPending && <QuestionCards pending={pending} onAnswer={onAnswer} t={t} />}
      </div>
      <div className={css.composer}>
        <textarea
          className={css.input}
          value={draft}
          rows={2}
          placeholder={t('chat.placeholder')}
          onChange={(event) => { setDraft(event.target.value) }}
          onKeyDown={(event) => {
            if (event.key === 'Enter' && !event.shiftKey) {
              event.preventDefault()
              send()
            }
          }}
        />
        <div className={css.actions}>
          {transcript.running && (
            <Button
              size="sm"
              variant="ghost"
              icon={<IconStopFill16 />}
              onClick={onStop}
              title={t('chat.stop')}
              aria-label={t('chat.stop')}
            />
          )}
          <Button
            size="sm"
            variant="primary"
            icon={<IconSendOutline14 />}
            onClick={send}
            disabled={draft.trim().length === 0}
            title={t('chat.send')}
            aria-label={t('chat.send')}
          >
            {t('chat.send')}
          </Button>
        </div>
      </div>
    </div>
  )
}

/** One transcript row: a user bubble, an assistant bubble, or a process group. */
function Bubble({
  entry, labels, t,
}: {
  entry: TranscriptEntry
  labels: MarkdownLabels
  t: TranslateNS<'video'>
}) {
  if (entry.kind === 'user') {
    return (
      <div className={clsx(css.row, css.rowUser)}>
        <div className={clsx(css.bubble, css.bubbleUser)}>{entry.text}</div>
      </div>
    )
  }
  if (entry.kind === 'assistant') {
    return (
      <div className={clsx(css.row, css.rowAgent)}>
        <div className={clsx(css.bubble, css.bubbleAgent)}>
          <MarkdownText text={entry.text} streaming={entry.streaming} labels={labels} variant="compact" />
        </div>
      </div>
    )
  }
  return <ProcessRow entry={entry} labels={labels} t={t} />
}

/** One turn's collapsible intermediate steps. */
function ProcessRow({
  entry, labels, t,
}: {
  entry: TranscriptProcessEntry
  labels: MarkdownLabels
  t: TranslateNS<'video'>
}) {
  // Null until the operator overrides the default: open while running, closed
  // once the turn settles, so finished work collapses without a manual click.
  const [toggled, setToggled] = useState<boolean | null>(null)
  const open = toggled ?? !entry.done
  const title = entry.done
    ? t('chat.process', { count: entry.steps.length })
    : t('chat.process-running')
  return (
    <div className={clsx(css.row, css.rowAgent)}>
      <div className={css.process}>
        <DisclosureRow
          icon={<IconThinkOutline16 />}
          title={title}
          open={open}
          expandable={entry.steps.length > 0}
          onToggle={() => { setToggled(!open) }}
        >
          {entry.steps.map(step => <StepView key={step.id} step={step} labels={labels} />)}
        </DisclosureRow>
      </div>
    </div>
  )
}

/** One intermediate step: a tool call, a text passage, or reasoning. */
function StepView({ step, labels }: { step: TranscriptStep; labels: MarkdownLabels }) {
  if (step.kind === 'tool') {
    // ask_user_question renders as cards below, so its raw arguments are hidden.
    const isAsk = step.name === ASK_TOOL
    return (
      <div className={css.step}>
        <div className={css.stepHead}>
          <IconCodeOutline16 />
          <span className={css.toolName}>{step.name || '…'}</span>
          {step.isError && <span className={css.toolError}>error</span>}
        </div>
        {!isAsk && step.args.length > 0 && <pre className={css.pre}>{step.args}</pre>}
        {!isAsk && step.result !== undefined && <pre className={css.pre}>{step.result}</pre>}
      </div>
    )
  }
  if (step.kind === 'reasoning') {
    return <pre className={clsx(css.pre, css.reasoning)}>{step.text}</pre>
  }
  return (
    <div className={css.step}>
      <MarkdownText text={step.text} streaming={step.streaming} labels={labels} variant="compact" />
    </div>
  )
}

/**
 * The pending ask_user_question rendered as numbered option cards. Each
 * question lists its options as clickable numbered cards; a number entry below
 * the options accepts a 1-based choice (comma- or space-separated for
 * multi-select) and continues the turn. Selecting cards and typing numbers stay
 * in sync, and any non-numeric text is submitted as a free-form answer.
 */
function QuestionCards({
  pending, onAnswer, t,
}: {
  pending: PendingQuestionView
  onAnswer: ChatPanelProps['onAnswer']
  t: TranslateNS<'video'>
}) {
  const [selected, setSelected] = useState<Record<string, readonly number[]>>({})
  const [text, setText] = useState<Record<string, string>>({})

  // A new pending batch starts from a clean selection.
  useEffect(() => {
    setSelected({})
    setText({})
  }, [pending.key])

  const toggle = (questionId: string, index: number, multi: boolean): void => {
    setSelected((previous) => {
      const current = previous[questionId] ?? []
      if (!multi) return { ...previous, [questionId]: current.includes(index) ? [] : [index] }
      const next = current.includes(index)
        ? current.filter(candidate => candidate !== index)
        : [...current, index]
      return { ...previous, [questionId]: next }
    })
  }

  const submit = (): void => {
    const lines: PendingAnswerLine[] = pending.questions.map((question) => {
      const typed = text[question.id] ?? ''
      const parsed = parseIndices(typed, question.options.length)
      const indices = parsed === undefined ? (selected[question.id] ?? []) : parsed
      const chosen = indices
        .map(index => question.options[index]?.label)
        .filter((label): label is string => label !== undefined)
      const custom = parseCustom(typed)
      return {
        id: question.id,
        selected: chosen,
        ...(custom === undefined ? {} : { custom }),
      }
    })
    if (lines.every(line => line.selected.length === 0 && line.custom === undefined)) return
    onAnswer(lines)
  }

  return (
    <div className={clsx(css.row, css.rowAgent)}>
      <div className={css.question}>
        {pending.questions.map((question) => {
          const chosen = selected[question.id] ?? []
          return (
            <div key={question.id} className={css.questionBlock}>
              {question.header !== undefined && (
                <span className={css.questionHeader}>{question.header}</span>
              )}
              <p className={css.questionText}>{question.question}</p>
              <div className={css.options}>
                {question.options.map((option, index) => (
                  <button
                    key={option.label}
                    type="button"
                    className={clsx(css.option, chosen.includes(index) && css.optionSelected)}
                    onClick={() => { toggle(question.id, index, question.multiSelect) }}
                    aria-pressed={chosen.includes(index)}
                  >
                    <span className={css.optionIndex}>{index + 1}</span>
                    <span className={css.optionBody}>
                      <span className={css.optionLabel}>{option.label}</span>
                      {option.description !== undefined && (
                        <span className={css.optionDescription}>{option.description}</span>
                      )}
                    </span>
                  </button>
                ))}
              </div>
              <input
                className={css.questionInput}
                value={text[question.id] ?? ''}
                placeholder={question.multiSelect ? t('question.placeholder-multi') : t('question.placeholder')}
                onChange={(event) =>{  setText(previous => ({ ...previous, [question.id]: event.target.value })) }}
                onKeyDown={(event) => {
                  if (event.key === 'Enter') {
                    event.preventDefault()
                    submit()
                  }
                }}
              />
            </div>
          )
        })}
        <div className={css.questionActions}>
          <Button size="sm" variant="primary" onClick={submit}>
            {t('question.continue')}
          </Button>
        </div>
      </div>
    </div>
  )
}

/**
 * Parse a typed number entry into zero-based option indices.
 * @param value - raw text from the question entry.
 * @param count - number of options the question offers.
 * @returns the referenced indices, or undefined when the text names none.
 */
function parseIndices(value: string, count: number): readonly number[] | undefined {
  const tokens = value.split(/[,\s]+/).filter(token => token.length > 0)
  if (tokens.length === 0) return undefined
  const indices: number[] = []
  let sawNumber = false
  for (const token of tokens) {
    if (!/^\d+$/.test(token)) continue
    sawNumber = true
    const index = Number(token) - 1
    if (index >= 0 && index < count && !indices.includes(index)) indices.push(index)
  }
  return sawNumber ? indices : undefined
}

/**
 * Extract free-form answer text from a typed entry.
 * @param value - raw text from the question entry.
 * @returns the non-numeric remainder, or undefined when the entry is only numbers.
 */
function parseCustom(value: string): string | undefined {
  const remainder = value
    .split(/[,\s]+/)
    .filter(token => token.length > 0 && !/^\d+$/.test(token))
    .join(' ')
    .trim()
  return remainder.length === 0 ? undefined : remainder
}
