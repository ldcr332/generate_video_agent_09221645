import { afterEach, describe, expect, it, vi } from 'vitest'
import { Context } from '@deepseek-ai/cordis'
import { ToolCallId } from '@deepseek-ai/dsh-llm'
import SystemPrompt from '@deepseek-ai/dsh-system-prompt'
import ToolRuntime from '@deepseek-ai/dsh-tools'
import * as plugin from '../src/index.ts'

afterEach(() => { vi.unstubAllGlobals(); delete process.env.EVOLINK_API_KEY })

function json(body: unknown): Response {
  return new Response(JSON.stringify(body), { status: 200, headers: { 'content-type': 'application/json' } })
}

describe('tool-evolink-image', () => {
  it('creates a task and polls it to completion', async () => {
    process.env.EVOLINK_API_KEY = 'test-key'
    const fetchMock = vi.fn()
      .mockResolvedValueOnce(json({ id: 'task-1', status: 'pending' }))
      .mockResolvedValueOnce(json({ id: 'task-1', status: 'processing' }))
      .mockResolvedValueOnce(json({ id: 'task-1', status: 'completed', results: ['https://images.test/result.webp'] }))
    vi.stubGlobal('fetch', fetchMock)
    const ctx = new Context()
    await ctx.plugin(SystemPrompt)
    await ctx.plugin(ToolRuntime)
    const fiber = await ctx.plugin(plugin, { pollIntervalMs: 1, maxPollAttempts: 3 })
    const result = await ctx.tools.execute({
      callId: ToolCallId('image-1'), name: 'generate_image', signal: new AbortController().signal,
      arguments: { prompt: 'a glowing fox', size: '1:1', seed: 42, nsfw_check: false },
    })
    expect(result.isError).toBe(false)
    expect(result.content).toEqual([{ type: 'text', text: 'Generated 1 image(s):\nhttps://images.test/result.webp' }])
    expect(fetchMock).toHaveBeenCalledTimes(3)
    const [createUrl, createInit] = fetchMock.mock.calls[0] as [string, RequestInit]
    expect(createUrl).toBe('https://api.evolink.ai/v1/images/generations')
    const headers = new Headers(createInit.headers)
    expect(headers.get('authorization')).toBe('Bearer test-key')
    expect(headers.get('content-type')).toBe('application/json')
    expect(JSON.parse(createInit.body as string)).toEqual({ model: 'z-image-turbo', prompt: 'a glowing fox', size: '1:1', seed: 42, nsfw_check: false })
    expect(fetchMock.mock.calls.slice(1).map((call: unknown[]) => String(call[0]))).toEqual([
      'https://api.evolink.ai/v1/tasks/task-1', 'https://api.evolink.ai/v1/tasks/task-1',
    ])
    await fiber.dispose()
  })

  it('requires the configured environment key before creating a task', async () => {
    const fetchMock = vi.fn()
    vi.stubGlobal('fetch', fetchMock)
    const ctx = new Context()
    await ctx.plugin(SystemPrompt)
    await ctx.plugin(ToolRuntime)
    const fiber = await ctx.plugin(plugin)
    const result = await ctx.tools.execute({
      callId: ToolCallId('image-2'), name: 'generate_image', signal: new AbortController().signal, arguments: { prompt: 'a fox' },
    })
    expect(result.isError).toBe(true)
    expect(result.content.map(block => block.type === 'text' ? block.text : '').join('\n')).toContain('EVOLINK_API_KEY is not configured')
    expect(fetchMock).not.toHaveBeenCalled()
    await fiber.dispose()
  })
})
