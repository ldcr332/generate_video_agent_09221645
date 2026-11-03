---
description: "Synthesize speech from text through Qwen3-TTS from a DeepSeek Harness Agent Tool."
kind: "package-reference"
---

# @deepseek-ai/dsh-tool-tts

English | [中文](README.zh.md)

## Summary

This Cordis plugin registers `text_to_speech` on `ctx.tools`. It sends one synthesis request to the Qwen text-to-speech model and returns the audio URL the provider generates.

## Configuration

The plugin reads its key from the launch environment. Put `DASHSCOPE_API_KEY=...` in the project or Harness-home `.env`; environment variables inherited by the process take precedence. Do not put a key in `cordis.yml`.

| Field | Default | Meaning |
|---|---|---|
| `apiKeyEnv` | `DASHSCOPE_API_KEY` | Environment variable holding the API key. |
| `baseUrl` | `https://dashscope.aliyuncs.com/api/v1` | Provider API root. |
| `model` | `qwen3-tts-flash` | Speech-synthesis model. |
| `voice` | `Cherry` | Voice used when a call omits `voice`. |
| `requestTimeoutMs` | `30000` | Timeout for the synthesis HTTP request. |

The shared base bundle ships the `tool-tts` row disabled. It appears in the Settings plugin inventory, and the Plugins manager can enable or disable it for the current profile. Base-backed Web profiles keep global tools out of Agent preset realms; add the same row to a preset when that deployment needs the tool in Web sessions.

## Model Experience

### Text-to-speech tool

#### What the model sees

The generated [tool catalog](../../../docs/tool-catalog.md) describes `text_to_speech`, including the `text`, `voice`, and `language_type` inputs. A successful call returns the synthesized audio URL and its expiry timestamp.

#### Token effect

The tool schema is visible while the plugin is enabled. Each call appends its rendered audio URL to the conversation.

#### KV Cache effect

Enabling or disabling the plugin changes the tool-schema portion of a later request. Results append to the transcript.

## Known Limitations and Deferred Work

- The provider returns a time-limited audio URL rather than durable bytes; callers that need a persistent file must download it before the URL expires.
- Voice availability depends on the selected model; the `voice` input is passed through to the provider, which rejects identifiers its model does not support.
