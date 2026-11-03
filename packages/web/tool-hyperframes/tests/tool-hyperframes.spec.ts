import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { Context } from '@deepseek-ai/cordis'
import { ToolCallId } from '@deepseek-ai/dsh-llm'
import SystemPrompt from '@deepseek-ai/dsh-system-prompt'
import ToolRuntime from '@deepseek-ai/dsh-tools'
import sharp from 'sharp'
import * as plugin from '../src/index.ts'

const fixturePath = path.join(import.meta.dirname, 'fixtures', 'fake-hyperframes.mjs')
const toolNames = ['video_lint', 'video_snapshot', 'video_render']
const tempDirs: string[] = []

function makeProject(): string {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'dsh-hf-'))
  tempDirs.push(dir)
  fs.writeFileSync(path.join(dir, 'index.html'), '<!doctype html><html></html>')
  return dir
}

async function boot(config: Record<string, unknown> = {}) {
  const ctx = new Context()
  await ctx.plugin(SystemPrompt)
  await ctx.plugin(ToolRuntime)
  const fiber = await ctx.plugin(plugin, { command: process.execPath, commandArgs: [fixturePath], ...config })
  return { ctx, fiber }
}

async function call(ctx: Context, name: string, args: Record<string, unknown>) {
  return ctx.tools.execute({
    callId: ToolCallId(`${name}-call`), name, signal: new AbortController().signal, arguments: args,
  })
}

function textOf(result: { content: ReadonlyArray<{ type: string; text?: string }> }): string {
  return result.content.map(block => block.type === 'text' ? block.text ?? '' : '').join('\n')
}

function cliLog(): string[][] {
  return fs.readFileSync(process.env.FIXTURE_LOG!, 'utf8').trim().split('\n').map(line => JSON.parse(line) as string[])
}

afterEach(() => {
  for (const dir of tempDirs.splice(0)) fs.rmSync(dir, { recursive: true, force: true })
  delete process.env.FIXTURE_MODE
  delete process.env.FIXTURE_LOG
})

describe('tool-hyperframes', () => {
  it('video_lint parses the JSON report even when the CLI exits non-zero', async () => {
    const dir = makeProject()
    const log = path.join(dir, 'cli.log')
    process.env.FIXTURE_LOG = log
    const { ctx, fiber } = await boot()
    const result = await call(ctx, 'video_lint', { projectPath: dir })
    expect(result.isError).toBe(false)
    const text = textOf(result)
    expect(text).toContain('HyperFrames lint: 1 error(s), 1 warning(s)')
    expect(text).toContain('[error] missing_timeline_registry: Missing registration.')
    expect(text).toContain('[warning] studio_missing_editable_id: No stable id.')
    expect(cliLog()).toEqual([['lint', dir, '--json']])
    await fiber.dispose()
  })

  it('video_snapshot captures the exact times and tiles a three-per-row grid', async () => {
    const dir = makeProject()
    const log = path.join(dir, 'cli.log')
    process.env.FIXTURE_LOG = log
    const { ctx, fiber } = await boot()
    const result = await call(ctx, 'video_snapshot', { projectPath: dir, times: [0.5, 1.5] })
    expect(result.isError).toBe(false)
    const text = textOf(result)
    expect(text).toContain('Snapshot grid (2 frame(s), 3 per row):')
    const gridPath = path.join(dir, 'snapshots')
    const invocation = cliLog()[0]!
    expect(invocation.slice(0, 2)).toEqual(['snapshot', dir])
    expect(invocation).toContain('--no-end')
    expect(invocation[invocation.indexOf('--at') + 1]).toBe('0.5,1.5')
    const sessionDirs = fs.readdirSync(gridPath)
    expect(sessionDirs).toHaveLength(1)
    const sessionDir = path.join(gridPath, sessionDirs[0]!)
    const frames = fs.readdirSync(sessionDir).filter(entry => entry.endsWith('.png') && entry !== 'grid.png').sort()
    expect(frames).toEqual(['frame-00-at-0.5s.png', 'frame-01-at-1.5s.png'])
    const metadata = await sharp(path.join(sessionDir, 'grid.png')).metadata()
    expect(metadata.width).toBe(3)
    expect(metadata.height).toBe(1)
    await fiber.dispose()
  })

  it('video_snapshot rejects more than nine time points without spawning the CLI', async () => {
    const dir = makeProject()
    process.env.FIXTURE_LOG = path.join(dir, 'cli.log')
    const { ctx, fiber } = await boot()
    const result = await call(ctx, 'video_snapshot', { projectPath: dir, times: [0, 1, 2, 3, 4, 5, 6, 7, 8, 9] })
    expect(result.isError).toBe(true)
    expect(textOf(result)).toContain('at most 9 time points are supported')
    expect(fs.existsSync(process.env.FIXTURE_LOG)).toBe(false)
    await fiber.dispose()
  })

  it('video_render returns the verified output path and size', async () => {
    const dir = makeProject()
    const log = path.join(dir, 'cli.log')
    process.env.FIXTURE_LOG = log
    const output = path.join(dir, 'out', 'video.mp4')
    const { ctx, fiber } = await boot()
    const result = await call(ctx, 'video_render', { projectPath: dir, quality: 'draft', output })
    expect(result.isError).toBe(false)
    expect(textOf(result)).toContain(`Rendered MP4 (${fs.statSync(output).size} bytes):\n${output}`)
    expect(cliLog()).toEqual([['render', dir, '-o', output, '--quality', 'draft', '--format', 'mp4']])
    await fiber.dispose()
  })

  it('video_render surfaces a CLI failure message', async () => {
    const dir = makeProject()
    process.env.FIXTURE_MODE = 'fail'
    const { ctx, fiber } = await boot()
    const result = await call(ctx, 'video_render', { projectPath: dir })
    expect(result.isError).toBe(true)
    expect(textOf(result)).toContain('FFmpeg not found')
    await fiber.dispose()
  })

  it('rejects a path that is not a HyperFrames project', async () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'dsh-not-hf-'))
    tempDirs.push(dir)
    process.env.FIXTURE_LOG = path.join(dir, 'cli.log')
    const { ctx, fiber } = await boot()
    const result = await call(ctx, 'video_lint', { projectPath: dir })
    expect(result.isError).toBe(true)
    expect(textOf(result)).toContain('not a HyperFrames project')
    expect(fs.existsSync(process.env.FIXTURE_LOG)).toBe(false)
    await fiber.dispose()
  })

  it('unregisters every tool when the plugin fiber is disposed', async () => {
    const { ctx, fiber } = await boot()
    for (const name of toolNames) {
      expect(ctx.tools.schemas().some(schema => schema.name === name)).toBe(true)
    }
    await fiber.dispose()
    for (const name of toolNames) {
      expect(ctx.tools.schemas().some(schema => schema.name === name)).toBe(false)
    }
  })
})
