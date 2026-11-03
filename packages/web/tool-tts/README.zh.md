---
description: "通过 DeepSeek Harness Agent Tool 调用 Qwen3-TTS 将文字合成为语音。"
kind: "package-reference"
---

# @deepseek-ai/dsh-tool-tts

[English](README.md) | 中文

## 概述

此 Cordis 插件在 `ctx.tools` 注册 `text_to_speech`。它向 Qwen 语音合成模型发送一次合成请求，并返回提供方生成的音频 URL。

## 配置

插件从启动环境读取密钥。请在项目或 Harness home 的 `.env` 中设置 `DASHSCOPE_API_KEY=...`；进程继承的环境变量优先。不要将密钥写入 `cordis.yml`。

| 字段 | 默认值 | 含义 |
|---|---|---|
| `apiKeyEnv` | `DASHSCOPE_API_KEY` | 保存 API 密钥的环境变量。 |
| `baseUrl` | `https://dashscope.aliyuncs.com/api/v1` | 提供方 API 根地址。 |
| `model` | `qwen3-tts-flash` | 语音合成模型。 |
| `voice` | `Cherry` | 调用未指定 `voice` 时使用的音色。 |
| `requestTimeoutMs` | `30000` | 合成 HTTP 请求的超时。 |

共享基础 bundle 默认关闭 `tool-tts` 行。它会出现在设置的插件清单中，且当前 profile 可在插件管理器中启用或关闭。基础 Web profile 会将全局工具排除在 Agent preset realm 之外；部署需要在 Web 会话中使用时，应在相应 preset 加入同一行。

## 模型体验

### 语音合成工具

#### 模型看到的内容

生成的[工具目录](../../../docs/tool-catalog.zh.md)说明 `text_to_speech`，包括 `text`、`voice` 与 `language_type` 输入。成功调用会返回合成的音频 URL 及其过期时间戳。

#### Token 影响

插件启用时工具 schema 对模型可见。每次调用将渲染后的音频 URL 追加至会话。

#### KV Cache 影响

启用或关闭插件会改变后续请求中的工具 schema 部分。结果会追加至会话记录。

## 已知限制与延后工作

- 提供方返回的是有时限的音频 URL，而非持久字节；需要持久文件的调用方须在 URL 过期前下载。
- 可用音色取决于所选模型；`voice` 输入会原样传给提供方，提供方会拒绝其模型不支持的音色标识。
