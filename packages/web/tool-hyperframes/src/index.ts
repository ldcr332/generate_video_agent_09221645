/**
 * Model-facing HyperFrames video tools: lint, snapshot grid, and MP4 render.
 * @module @deepseek-ai/dsh-tool-hyperframes
 */

import { execFile } from 'node:child_process'
import fs from 'node:fs'
import path from 'node:path'
import { promisify } from 'node:util'
import type { Context } from '@deepseek-ai/cordis'
import z from '@deepseek-ai/schemastery'
import { defineTool } from '@deepseek-ai/dsh-tools'
import { requireSharp } from './sharp.ts'

/** Cordis plugin name used by the Loader and plugin inventory. */
export const name = 'tool-hyperframes'

/** The model-facing tool registry this plugin contributes to. */
export const inject = ['tools']

const execFileAsync = promisify(execFile)

const DEFAULT_COMMAND = 'npx'
const DEFAULT_COMMAND_ARGS = ['--yes', 'hyperframes']
const DEFAULT_LINT_TIMEOUT_MS = 120_000
const DEFAULT_SNAPSHOT_TIMEOUT_MS = 300_000
const DEFAULT_RENDER_TIMEOUT_MS = 1_800_000
const MAX_SNAPSHOT_FRAMES = 9
const GRID_COLUMNS = 3
const MAX_OUTPUT_BYTES = 32 * 1024 * 1024
const MAX_CLI_DETAIL_CHARS = 4_000

/** Deployment configuration for the HyperFrames tool wrappers. */
export interface Config {
  /** Executable that launches the HyperFrames CLI. Defaults to `npx`. */
  command?: string
  /** Arguments inserted between `command` and the subcommand. Defaults to `["--yes", "hyperframes"]`. */
  commandArgs?: string[]
  /** `video_lint` timeout in milliseconds. Defaults to 120000. */
  lintTimeoutMs?: number
  /** `video_snapshot` timeout in milliseconds. Defaults to 300000. */
  snapshotTimeoutMs?: number
  /** `video_render` timeout in milliseconds. Defaults to 1800000. */
  renderTimeoutMs?: number
}

/** Schemas for Loader-validated plugin configuration. */
export const Config: z<Config> = z.object({
  command: z.string().default(DEFAULT_COMMAND),
  commandArgs: z.array(z.string()).default([...DEFAULT_COMMAND_ARGS]),
  lintTimeoutMs: z.number().step(1).min(1).default(DEFAULT_LINT_TIMEOUT_MS),
  snapshotTimeoutMs: z.number().step(1).min(1).default(DEFAULT_SNAPSHOT_TIMEOUT_MS),
  renderTimeoutMs: z.number().step(1).min(1).default(DEFAULT_RENDER_TIMEOUT_MS),
})

type ResolvedConfig = Required<Config>

interface CliResult {
  exitedZero: boolean
  stdout: string
  stderr: string
}

interface LintFinding {
  code: string
  severity: string
  message: string
  fixHint?: string
  file?: string
  line?: number
}

interface LintReport {
  ok: boolean
  errorCount: number
  warningCount: number
  findings: LintFinding[]
}

/** Run one HyperFrames CLI invocation without a shell, propagating caller cancellation. */
async function runCli(
  resolved: ResolvedConfig,
  args: string[],
  signal: AbortSignal,
  timeoutMs: number,
): Promise<CliResult> {
  try {
    const { stdout, stderr } = await execFileAsync(resolved.command, [...resolved.commandArgs, ...args], {
      signal: AbortSignal.any([signal, AbortSignal.timeout(timeoutMs)]),
      maxBuffer: MAX_OUTPUT_BYTES,
    })
    return { exitedZero: true, stdout, stderr }
  } catch (error) {
    if (signal.aborted) throw error
    const failure = error as { stdout?: unknown; stderr?: unknown }
    return {
      exitedZero: false,
      stdout: typeof failure.stdout === 'string' ? failure.stdout : '',
      stderr: typeof failure.stderr === 'string' ? failure.stderr : (error as Error).message,
    }
  }
}

/** Trim and cap CLI output for inclusion in a tool error message. */
function cliDetail(result: CliResult): string {
  const detail = (result.stderr.trim() !== '' ? result.stderr : result.stdout).trim()
  const suffix = detail.length > MAX_CLI_DETAIL_CHARS ? '…' : ''
  return detail.slice(0, MAX_CLI_DETAIL_CHARS) + suffix
}

/** Resolve the project path and require the HyperFrames entry file. */
function resolveProjectDir(projectPath: string): string {
  const dir = path.resolve(projectPath.trim())
  if (!fs.statSync(dir, { throwIfNoEntry: false })?.isDirectory()) {
    throw new Error(`video tool: ${dir} is not a directory`)
  }
  if (!fs.existsSync(path.join(dir, 'index.html'))) {
    throw new Error(`video tool: ${dir} is not a HyperFrames project (index.html not found)`)
  }
  return dir
}

function timestamp(): string {
  return new Date().toISOString().replace(/[:.]/g, '-')
}

function asString(value: unknown): string | undefined {
  return typeof value === 'string' && value !== '' ? value : undefined
}

function parseLintFinding(entry: unknown, index: number): LintFinding {
  const finding = entry as { code?: unknown; severity?: unknown; message?: unknown; fixHint?: unknown; file?: unknown; line?: unknown }
  const fixHint = asString(finding.fixHint)
  const file = asString(finding.file)
  const line = typeof finding.line === 'number' ? Math.trunc(finding.line) : undefined
  return {
    code: asString(finding.code) ?? `finding-${index}`,
    severity: asString(finding.severity) ?? 'info',
    message: asString(finding.message) ?? '(no message)',
    ...(fixHint === undefined ? {} : { fixHint }),
    ...(file === undefined ? {} : { file }),
    ...(line === undefined ? {} : { line }),
  }
}

/** Parse the `lint --json` envelope, which the CLI also prints on a non-zero exit. */
function parseLintReport(result: CliResult): LintReport {
  let parsed: unknown
  try {
    parsed = JSON.parse(result.stdout)
  } catch {
    throw new Error(`hyperframes lint produced no parseable JSON report: ${cliDetail(result)}`)
  }
  if (typeof parsed !== 'object' || parsed === null || !Array.isArray((parsed as { findings?: unknown }).findings)) {
    throw new Error(`hyperframes lint produced no parseable JSON report: ${cliDetail(result)}`)
  }
  const envelope = parsed as { ok?: unknown; errorCount?: unknown; warningCount?: unknown; findings: unknown[] }
  const findings = envelope.findings.map(parseLintFinding)
  const errorCount = typeof envelope.errorCount === 'number'
    ? Math.trunc(envelope.errorCount)
    : findings.filter(finding => finding.severity === 'error').length
  const warningCount = typeof envelope.warningCount === 'number'
    ? Math.trunc(envelope.warningCount)
    : findings.filter(finding => finding.severity === 'warning').length
  return {
    ok: typeof envelope.ok === 'boolean' ? envelope.ok : errorCount === 0,
    errorCount,
    warningCount,
    findings,
  }
}

/** Validate capture times at the model-input boundary. */
function normalizeTimes(times: number[]): number[] {
  if (times.length === 0) throw new Error('video_snapshot: times must contain at least one entry')
  if (times.length > MAX_SNAPSHOT_FRAMES) {
    throw new Error(`video_snapshot: at most ${MAX_SNAPSHOT_FRAMES} time points are supported, got ${times.length}`)
  }
  return times.map((time, index) => {
    if (typeof time !== 'number' || !Number.isFinite(time) || time < 0) {
      throw new Error(`video_snapshot: times[${index}] must be a non-negative number of seconds`)
    }
    return time
  })
}

/** Tile captured frames into one PNG grid, three per row, on a dark background. */
async function composeGrid(framePaths: string[], gridPath: string): Promise<void> {
  const sharp = requireSharp()
  const metadata = await sharp(framePaths[0]).metadata()
  const width = metadata.width
  const height = metadata.height
  const rows = Math.ceil(framePaths.length / GRID_COLUMNS)
  await sharp({
    create: {
      width: width * GRID_COLUMNS,
      height: height * rows,
      channels: 3,
      background: { r: 16, g: 16, b: 16 },
    },
  })
    .composite(framePaths.map((frame, index) => ({
      input: frame,
      left: (index % GRID_COLUMNS) * width,
      top: Math.floor(index / GRID_COLUMNS) * height,
    })))
    .png()
    .toFile(gridPath)
}

const projectPathParameter = {
  type: 'string',
  required: true,
  description: 'Path to a HyperFrames project directory (must contain index.html).',
} as const

/** Register the `video_lint`, `video_snapshot`, and `video_render` Agent Tools. */
export function apply(ctx: Context, config: Config): void {
  const resolved = config as ResolvedConfig

  ctx.tools.register(defineTool({
    name: 'video_lint',
    description: 'Run the HyperFrames static contract check on a project and report syntax and structure findings without opening a browser.',
    timeoutMs: resolved.lintTimeoutMs,
    parameters: { projectPath: projectPathParameter },
    output: {
      schema: {
        type: 'object', additionalProperties: false, properties: {
          ok: { type: 'boolean', required: true },
          errorCount: { type: 'integer', required: true },
          warningCount: { type: 'integer', required: true },
          findings: {
            type: 'array', required: true, items: {
              type: 'object', additionalProperties: false, properties: {
                code: { type: 'string', required: true },
                severity: { type: 'string', required: true },
                message: { type: 'string', required: true },
                fixHint: { type: 'string' },
                file: { type: 'string' },
                line: { type: 'integer' },
              },
            },
          },
        },
      },
      render: (_args, value) => [{
        type: 'text',
        text: [
          `HyperFrames lint: ${value.errorCount} error(s), ${value.warningCount} warning(s)`,
          ...value.findings.map(finding => `- [${finding.severity}] ${finding.code}: ${finding.message}`),
        ].join('\n'),
      }],
    },
    async execute(args, exec) {
      const dir = resolveProjectDir(args.projectPath)
      const result = await runCli(resolved, ['lint', dir, '--json'], exec.signal, resolved.lintTimeoutMs)
      return parseLintReport(result)
    },
  }))

  ctx.tools.register(defineTool({
    name: 'video_snapshot',
    description: 'Capture frames from a HyperFrames project at specific timeline times and combine them into one grid image, three frames per row.',
    timeoutMs: resolved.snapshotTimeoutMs,
    parameters: {
      projectPath: projectPathParameter,
      times: {
        type: 'array', required: true, items: { type: 'number' },
        description: `Capture times in seconds, in the order they should appear in the grid. Between 1 and ${MAX_SNAPSHOT_FRAMES} entries; each frame is rendered exactly at its time.`,
      },
    },
    output: {
      schema: {
        type: 'object', additionalProperties: false, properties: {
          gridPath: { type: 'string', required: true },
          frameCount: { type: 'integer', required: true },
          framePaths: { type: 'array', required: true, items: { type: 'string' } },
        },
      },
      render: (_args, value) => [{
        type: 'text',
        text: `Snapshot grid (${value.frameCount} frame(s), ${GRID_COLUMNS} per row):\n${value.gridPath}\nFrames:\n${value.framePaths.map(frame => `- ${frame}`).join('\n')}`,
      }],
    },
    async execute(args, exec) {
      const dir = resolveProjectDir(args.projectPath)
      const times = normalizeTimes(args.times)
      const outDir = path.join(dir, 'snapshots', `agent-${timestamp()}`)
      fs.mkdirSync(outDir, { recursive: true })
      const result = await runCli(
        resolved,
        ['snapshot', dir, '--at', times.map(time => String(time)).join(','), '--no-end', '-o', outDir],
        exec.signal,
        resolved.snapshotTimeoutMs,
      )
      if (!result.exitedZero) throw new Error(`hyperframes snapshot failed: ${cliDetail(result)}`)
      const framePaths = fs.readdirSync(outDir)
        .filter(entry => /^frame-\d{2}-at-.+\.png$/.test(entry))
        .sort()
        .map(entry => path.join(outDir, entry))
      if (framePaths.length === 0) {
        throw new Error(`hyperframes snapshot saved no frames to ${outDir}: ${cliDetail(result)}`)
      }
      const gridPath = path.join(outDir, 'grid.png')
      await composeGrid(framePaths, gridPath)
      return { gridPath, frameCount: framePaths.length, framePaths }
    },
  }))

  ctx.tools.register(defineTool({
    name: 'video_render',
    description: 'Render a HyperFrames project to an MP4 file and return the output path. Requires FFmpeg on PATH.',
    timeoutMs: resolved.renderTimeoutMs,
    parameters: {
      projectPath: projectPathParameter,
      quality: {
        type: 'string', enum: ['draft', 'looks', 'delivery'],
        description: 'Render quality preset: draft for fast iteration, looks for review, delivery for final output. Defaults to looks.',
      },
      output: { type: 'string', description: 'Output MP4 path. Defaults to <project>/renders/<project>-<timestamp>.mp4.' },
    },
    output: {
      schema: {
        type: 'object', additionalProperties: false, properties: {
          outputPath: { type: 'string', required: true },
          sizeBytes: { type: 'integer', required: true },
        },
      },
      render: (_args, value) => [{ type: 'text', text: `Rendered MP4 (${value.sizeBytes} bytes):\n${value.outputPath}` }],
    },
    async execute(args, exec) {
      const dir = resolveProjectDir(args.projectPath)
      const quality = args.quality ?? 'looks'
      const outputPath = args.output === undefined || args.output.trim() === ''
        ? path.join(dir, 'renders', `${path.basename(dir)}-${timestamp()}.mp4`)
        : path.resolve(args.output.trim())
      fs.mkdirSync(path.dirname(outputPath), { recursive: true })
      const result = await runCli(
        resolved,
        ['render', dir, '-o', outputPath, '--quality', quality, '--format', 'mp4'],
        exec.signal,
        resolved.renderTimeoutMs,
      )
      if (!result.exitedZero) throw new Error(`hyperframes render failed: ${cliDetail(result)}`)
      const sizeBytes = fs.statSync(outputPath, { throwIfNoEntry: false })?.size ?? 0
      if (sizeBytes === 0) {
        throw new Error(`hyperframes render exited successfully but ${outputPath} is missing or empty`)
      }
      return { outputPath, sizeBytes }
    },
  }))
}
