/**
 * Model-facing Qwen3-TTS text-to-speech tool.
 * @module @deepseek-ai/dsh-tool-tts
 */

import type { Context } from '@deepseek-ai/cordis'
import { launchEnvironmentOf } from '@deepseek-ai/dsh-launch-environment'
import z from '@deepseek-ai/schemastery'
import { defineTool } from '@deepseek-ai/dsh-tools'

/** Cordis plugin name used by the Loader and plugin inventory. */
export const name = 'tool-tts'

/** The model-facing tool registry this plugin contributes to. */
export const inject = ['tools']

const DEFAULT_BASE_URL = 'https://dashscope.aliyuncs.com/api/v1'
const DEFAULT_MODEL = 'qwen3-tts-flash'
const DEFAULT_VOICE = 'Cherry'
const DEFAULT_REQUEST_TIMEOUT_MS = 30_000
const SYNTHESIS_PATH = '/services/aigc/multimodal-generation/generation'

/** Deployment configuration for Qwen text-to-speech. */
export interface Config {
  /** Environment variable holding the DashScope API key. Defaults to `DASHSCOPE_API_KEY`. */
  apiKeyEnv?: string
  /** DashScope API root. Defaults to `https://dashscope.aliyuncs.com/api/v1`. */
  baseUrl?: string
  /** Speech-synthesis model identifier. Defaults to `qwen3-tts-flash`. */
  model?: string
  /** Voice used when a call omits `voice`. Defaults to `Cherry`. */
  voice?: string
  /** Per-request HTTP timeout in milliseconds. Defaults to 30000. */
  requestTimeoutMs?: number
}

/** Schemas for Loader-validated plugin configuration. */
export const Config: z<Config> = z.object({
  apiKeyEnv: z.string().default('DASHSCOPE_API_KEY'),
  baseUrl: z.string().default(DEFAULT_BASE_URL),
  model: z.string().default(DEFAULT_MODEL),
  voice: z.string().default(DEFAULT_VOICE),
  requestTimeoutMs: z.number().step(1).min(1).default(DEFAULT_REQUEST_TIMEOUT_MS),
})

type ResolvedConfig = Required<Config>

interface SynthesisResponse {
  request_id?: unknown
  code?: unknown
  message?: unknown
  output?: { audio?: { url?: unknown; expires_at?: unknown } }
}

/** Parse an API response body without hiding a non-JSON diagnostic. */
async function readResponse(response: Response): Promise<SynthesisResponse> {
  const text = await response.text()
  if (text === '') return {}
  try {
    const value: unknown = JSON.parse(text)
    return value !== null && typeof value === 'object' ? value : { message: text }
  } catch {
    return { message: text }
  }
}

/** Send one authenticated synthesis request and return the provider response body. */
async function synthesize(
  url: string,
  apiKey: string,
  body: unknown,
  signal: AbortSignal,
  requestTimeoutMs: number,
): Promise<SynthesisResponse> {
  const timeout = AbortSignal.timeout(requestTimeoutMs)
  const response = await fetch(url, {
    method: 'POST',
    redirect: 'error',
    headers: { authorization: `Bearer ${apiKey}`, 'content-type': 'application/json' },
    body: JSON.stringify(body),
    signal: AbortSignal.any([signal, timeout]),
  })
  const parsed = await readResponse(response)
  if (!response.ok) {
    const detail = typeof parsed.message === 'string' && parsed.message !== '' ? `: ${parsed.message}` : ''
    throw new Error(`Qwen text-to-speech request failed with HTTP ${response.status}${detail}`)
  }
  return parsed
}

/** Register the `text_to_speech` Agent Tool. */
export function apply(ctx: Context, config: Config): void {
  const resolved = config as ResolvedConfig
  const baseUrl = resolved.baseUrl.replace(/\/+$/, '')
  try { new URL(baseUrl) } catch { throw new Error('tool-tts: baseUrl must be an absolute URL') }

  ctx.tools.register(defineTool({
    name: 'text_to_speech',
    description: 'Synthesize speech from text with Qwen3-TTS and return a downloadable audio URL. Optionally choose a voice and the spoken language.',
    timeoutMs: resolved.requestTimeoutMs,
    parameters: {
      text: { type: 'string', required: true, description: 'The text to speak. Keep each call under about 600 characters; split longer text into multiple calls.' },
      voice: { type: 'string', description: `Voice identifier. Defaults to \`${resolved.voice}\`. Common voices: Cherry, Serena, Ethan, Chelsie, Dylan, Sunny, Jada, Li, Marcus, Roy, Peter, Rocky.` },
      language_type: { type: 'string', description: 'Spoken language hint. Defaults to Auto. One of: Chinese, English, German, Italian, Portuguese, Spanish, Japanese, Korean, French, Russian.' },
    },
    output: {
      schema: {
        type: 'object', additionalProperties: false, properties: {
          audioUrl: { type: 'string', required: true },
          expiresAt: { type: 'integer' },
        },
      },
      render: (_args, value) => [{ type: 'text', text: `Synthesized speech audio:\n${value.audioUrl}` }],
    },
    async execute(args, exec) {
      const text = args.text.trim()
      if (text === '') throw new Error('text_to_speech: text must not be empty')
      const apiKey = launchEnvironmentOf(ctx).get(resolved.apiKeyEnv)?.value
      if (apiKey === undefined || apiKey.trim() === '') {
        throw new Error(`text_to_speech: ${resolved.apiKeyEnv} is not configured`)
      }
      const voice = args.voice === undefined || args.voice.trim() === '' ? resolved.voice : args.voice.trim()
      const response = await synthesize(`${baseUrl}${SYNTHESIS_PATH}`, apiKey, {
        model: resolved.model,
        input: {
          text,
          voice,
          language_type: args.language_type ?? 'Auto',
        },
      }, exec.signal, resolved.requestTimeoutMs)

      const audio = response.output?.audio
      if (typeof audio?.url !== 'string' || audio.url === '') {
        const detail = typeof response.message === 'string' && response.message !== '' ? `: ${response.message}` : ''
        throw new Error(`Qwen text-to-speech returned no audio URL${detail}`)
      }
      const expiresAt = typeof audio.expires_at === 'number' ? audio.expires_at : undefined
      return expiresAt === undefined ? { audioUrl: audio.url } : { audioUrl: audio.url, expiresAt }
    },
  }))
}
