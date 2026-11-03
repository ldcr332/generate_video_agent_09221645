import { afterEach, describe, expect, it, vi } from 'vitest'
import { Context } from '@deepseek-ai/cordis'
import { ToolCallId } from '@deepseek-ai/dsh-llm'
import SystemPrompt from '@deepseek-ai/dsh-system-prompt'
import ToolRuntime from '@deepseek-ai/dsh-tools'
import * as plugin from '../src/index.ts'

afterEach(() => { vi.unstubAllGlobals(); delete process.env.DASHSCOPE_API_KEY })

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } })
}

const audioBody = { output: { audio: { url: 'https://audio.test/result.wav', expires_at: 1_766_113_409 } } }

async function boot(config?: Record<string, unknown>) {
  const ctx = new Context()
  await ctx.plugin(SystemPrompt)
  await ctx.plugin(ToolRuntime)
  const fiber = await ctx.plugin(plugin, config)
  return { ctx, fiber }
}

describe('tool-tts', () => {
  it('synthesizes speech and returns the audio URL', async () => {
    process.env.DASHSCOPE_API_KEY = 'test-key'
    const fetchMock = vi.fn().mockResolvedValue(json(audioBody))
    vi.stubGlobal('fetch', fetchMock)
    const { ctx, fiber } = await boot()
    const result = await ctx.tools.execute({
      callId: ToolCallId('tts-1'), name: 'text_to_speech', signal: new AbortController().signal,
      arguments: { text: 'Hello world' },
    })
    expect(result.isError).toBe(false)
    expect(result.content).toEqual([{ type: 'text', text: 'Synthesized speech audio:\nhttps://audio.test/result.wav' }])
    const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit]
    expect(url).toBe('https://dashscope.aliyuncs.com/api/v1/services/aigc/multimodal-generation/generation')
    const headers = new Headers(init.headers)
    expect(headers.get('authorization')).toBe('Bearer test-key')
    expect(headers.get('content-type')).toBe('application/json')
    expect(init.redirect).toBe('error')
    expect(JSON.parse(init.body as string)).toEqual({
      model: 'qwen3-tts-flash',
      input: { text: 'Hello world', voice: 'Cherry', language_type: 'Auto' },
    })
    await fiber.dispose()
  })

  it('honors an explicit voice and language', async () => {
    process.env.DASHSCOPE_API_KEY = 'test-key'
    const fetchMock = vi.fn().mockResolvedValue(json(audioBody))
    vi.stubGlobal('fetch', fetchMock)
    const { ctx, fiber } = await boot({ voice: 'Serena' })
    await ctx.tools.execute({
      callId: ToolCallId('tts-2'), name: 'text_to_speech', signal: new AbortController().signal,
      arguments: { text: 'Bonjour', voice: 'Ethan', language_type: 'French' },
    })
    const [, init] = fetchMock.mock.calls[0] as [string, RequestInit]
    expect(JSON.parse(init.body as string)).toEqual({
      model: 'qwen3-tts-flash',
      input: { text: 'Bonjour', voice: 'Ethan', language_type: 'French' },
    })
    await fiber.dispose()
  })

  it('surfaces a provider error message', async () => {
    process.env.DASHSCOPE_API_KEY = 'test-key'
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(json({ message: 'InvalidParameter: voice not found' }, 400)))
    const { ctx, fiber } = await boot()
    const result = await ctx.tools.execute({
      callId: ToolCallId('tts-3'), name: 'text_to_speech', signal: new AbortController().signal,
      arguments: { text: 'Hello' },
    })
    expect(result.isError).toBe(true)
    expect(result.content.map(block => block.type === 'text' ? block.text : '').join('\n')).toContain('InvalidParameter: voice not found')
    await fiber.dispose()
  })

  it('requires the configured environment key before any request', async () => {
    const fetchMock = vi.fn()
    vi.stubGlobal('fetch', fetchMock)
    const { ctx, fiber } = await boot()
    const result = await ctx.tools.execute({
      callId: ToolCallId('tts-4'), name: 'text_to_speech', signal: new AbortController().signal,
      arguments: { text: 'Hello' },
    })
    expect(result.isError).toBe(true)
    expect(result.content.map(block => block.type === 'text' ? block.text : '').join('\n')).toContain('DASHSCOPE_API_KEY is not configured')
    expect(fetchMock).not.toHaveBeenCalled()
    await fiber.dispose()
  })

  it('unregisters the tool when the plugin fiber is disposed', async () => {
    const { ctx, fiber } = await boot()
    expect(ctx.tools.schemas().some(schema => schema.name === 'text_to_speech')).toBe(true)
    await fiber.dispose()
    expect(ctx.tools.schemas().some(schema => schema.name === 'text_to_speech')).toBe(false)
  })
})
