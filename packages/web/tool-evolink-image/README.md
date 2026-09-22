---
description: "Generate images through EvoLink Z-Image Turbo from a DeepSeek Harness Agent Tool."
kind: "package-reference"
---

# @deepseek-ai/dsh-tool-evolink-image

English | [中文](README.zh.md)

## Summary

This Cordis plugin registers `generate_image` on `ctx.tools`. It creates an EvoLink image task, polls its status every five seconds by default, and returns the completed image URLs.

## Configuration

The plugin reads its key from the launch environment. Put `EVOLINK_API_KEY=...` in the project or Harness-home `.env`; environment variables inherited by the process take precedence. Do not put a key in `cordis.yml`.

| Field | Default | Meaning |
|---|---|---|
| `apiKeyEnv` | `EVOLINK_API_KEY` | Environment variable holding the API key. |
| `baseUrl` | `https://api.evolink.ai/v1` | EvoLink API root. |
| `model` | `z-image-turbo` | Image model sent when creating a task. |
| `pollIntervalMs` | `5000` | Delay between task-status requests. |
| `maxPollAttempts` | `60` | Maximum status requests after task creation. |
| `requestTimeoutMs` | `30000` | Timeout for each HTTP request. |

The shared base bundle ships the `tool-evolink-image` row disabled. It appears in the Settings plugin inventory, and the Plugins manager can enable or disable it for the current profile. Base-backed Web profiles keep global tools out of Agent preset realms; add the same row to a preset when that deployment needs the tool in Web sessions.

## Model Experience

### Image-generation tool

#### What the model sees

The generated [tool catalog](../../../docs/tool-catalog.md) describes `generate_image`, including prompt, size, seed, and `nsfw_check` inputs. A successful call returns one task id and the generated image URLs.

#### Token effect

The tool schema is visible while the plugin is enabled. Each call appends its rendered image URLs to the conversation.

#### KV Cache effect

Enabling or disabling the plugin changes the tool-schema portion of a later request. Results append to the transcript.

## Known Limitations and Deferred Work

- EvoLink result URLs are provider-managed and can expire; callers that need durable files must save them separately.
