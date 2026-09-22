/**
 * Model-facing EvoLink Z-Image Turbo generation tool.
 * @module @deepseek-ai/dsh-tool-evolink-image
 */

import { setTimeout } from 'node:timers/promises'
import type { Context } from '@deepseek-ai/cordis'
import { launchEnvironmentOf } from '@deepseek-ai/dsh-launch-environment'
import z from '@deepseek-ai/schemastery'
import { defineTool } from '@deepseek-ai/dsh-tools'

/** Cordis plugin name used by the Loader and plugin inventory. */
export const name = 'tool-evolink-image'

/** The model-facing tool registry this plugin contributes to. */
export const inject = ['tools']

const DEFAULT_BASE_URL = 'https://api.evolink.ai/v1'
const DEFAULT_MODEL = 'z-image-turbo'
const DEFAULT_POLL_INTERVAL_MS = 5_000
const DEFAULT_MAX_POLL_ATTEMPTS = 60
const DEFAULT_REQUEST_TIMEOUT_MS = 30_000

/** Deployment configuration for EvoLink image generation. */
export interface Config {
  /** Environment variable holding the EvoLink API key. Defaults to `EVOLINK_API_KEY`. */
  apiKeyEnv?: string
  /** EvoLink API root. Defaults to `https://api.evolink.ai/v1`. */
  baseUrl?: string
  /** EvoLink image model identifier. Defaults to `z-image-turbo`. */
  model?: string
  /** Delay between task-status requests in milliseconds. Defaults to 5000. */
  pollIntervalMs?: number
  /** Maximum task-status requests after task creation. Defaults to 60. */
  maxPollAttempts?: number
  /** Per-request HTTP timeout in milliseconds. Defaults to 30000. */
  requestTimeoutMs?: number
}

/** Schemas for Loader-validated plugin configuration. */
export const Config: z<Config> = z.object({
  apiKeyEnv: z.string().default('EVOLINK_API_KEY'),
  baseUrl: z.string().default(DEFAULT_BASE_URL),
  model: z.string().default(DEFAULT_MODEL),
  pollIntervalMs: z.number().step(1).min(1).default(DEFAULT_POLL_INTERVAL_MS),
  maxPollAttempts: z.number().step(1).min(1).default(DEFAULT_MAX_POLL_ATTEMPTS),
  requestTimeoutMs: z.number().step(1).min(1).default(DEFAULT_REQUEST_TIMEOUT_MS),
})

type ResolvedConfig = Required<Config>

interface TaskResponse {
  id?: unknown
  status?: unknown
  results?: unknown
  error?: unknown
}

/** Parse an API response body without hiding a non-JSON diagnostic. */
async function readResponse(response: Response): Promise<TaskResponse> {
  const text = await response.text()
  if (text === '') return {}
  try {
    const value: unknown = JSON.parse(text)
    return value !== null && typeof value === 'object' ? value : { error: text }
  } catch {
    return { error: text }
  }
}

/** Send one authenticated JSON request and return the provider task object. */
async function request(
  url: string,
  apiKey: string,
  init: RequestInit,
  signal: AbortSignal,
  requestTimeoutMs: number,
): Promise<TaskResponse> {
  const timeout = AbortSignal.timeout(requestTimeoutMs)
  const headers = new Headers(init.headers)
  headers.set('authorization', `Bearer ${apiKey}`)
  const response = await fetch(url, {
    ...init,
    headers,
    signal: AbortSignal.any([signal, timeout]),
  })
  const body = await readResponse(response)
  if (!response.ok) {
    const detail = typeof body.error === 'string' ? `: ${body.error}` : ''
    throw new Error(`EvoLink request failed with HTTP ${response.status}${detail}`)
  }
  return body
}

/** Require a non-empty string field supplied by EvoLink. */
function requiredString(value: unknown, field: string): string {
  if (typeof value !== 'string' || value.trim() === '') throw new Error(`EvoLink response is missing ${field}`)
  return value
}

/** Register the `generate_image` Agent Tool. */
export function apply(ctx: Context, config: Config): void {
  const resolved = config as ResolvedConfig
  const baseUrl = resolved.baseUrl.replace(/\/+$/, '')
  try { new URL(baseUrl) } catch { throw new Error('tool-evolink-image: baseUrl must be an absolute URL') }

  ctx.tools.register(defineTool({
    name: 'generate_image',
    description: 'Generate an image with EvoLink Z-Image Turbo. The call creates an asynchronous task, then waits for its completed image URLs.',
    timeoutMs: resolved.requestTimeoutMs * (resolved.maxPollAttempts + 1) + resolved.pollIntervalMs * resolved.maxPollAttempts,
    parameters: {
      prompt: { type: 'string', required: true, description: 'Detailed text prompt for the image.' },
      size: { type: 'string', description: 'Aspect ratio or pixel dimensions, for example `1:1`, `16:9`, or `1024x1024`.' },
      seed: { type: 'integer', description: 'Optional deterministic seed.' },
      nsfw_check: { type: 'boolean', description: 'Enable EvoLink stricter NSFW filtering. Defaults to false.' },
    },
    output: {
      schema: {
        type: 'object', additionalProperties: false, properties: {
          taskId: { type: 'string', required: true },
          images: { type: 'array', required: true, items: { type: 'string' } },
        },
      },
      render: (_args, value) => [{ type: 'text', text: `Generated ${value.images.length} image(s):\n${value.images.join('\n')}` }],
    },
    async execute(args, exec) {
      const prompt = args.prompt.trim()
      if (prompt === '') throw new Error('generate_image: prompt must not be empty')
      const apiKey = launchEnvironmentOf(ctx).get(resolved.apiKeyEnv)?.value
      if (apiKey === undefined || apiKey.trim() === '') {
        throw new Error(`generate_image: ${resolved.apiKeyEnv} is not configured`)
      }
      const task = await request(`${baseUrl}/images/generations`, apiKey, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          model: resolved.model,
          prompt,
          ...args.size === undefined ? {} : { size: args.size },
          ...args.seed === undefined ? {} : { seed: args.seed },
          ...args.nsfw_check === undefined ? {} : { nsfw_check: args.nsfw_check },
        }),
      }, exec.signal, resolved.requestTimeoutMs)
      const taskId = requiredString(task.id, 'task id')

      for (let attempt = 0; attempt < resolved.maxPollAttempts; attempt++) {
        await setTimeout(resolved.pollIntervalMs, undefined, { signal: exec.signal })
        const status = await request(`${baseUrl}/tasks/${encodeURIComponent(taskId)}`, apiKey, { method: 'GET' }, exec.signal, resolved.requestTimeoutMs)
        if (status.status === 'completed') {
          if (!Array.isArray(status.results) || !status.results.every(result => typeof result === 'string')) {
            throw new Error(`EvoLink task ${taskId} completed without image URLs`)
          }
          return { taskId, images: status.results }
        }
        if (status.status === 'failed' || status.status === 'cancelled') {
          const detail = typeof status.error === 'string' ? `: ${status.error}` : ''
          throw new Error(`EvoLink task ${taskId} ${status.status}${detail}`)
        }
      }
      throw new Error(`EvoLink task ${taskId} did not complete after ${resolved.maxPollAttempts} polls`)
    },
  }))
}
