---
description: "通过 DeepSeek Harness Agent Tool 调用 EvoLink Z-Image Turbo 生成图片。"
kind: "package-reference"
---

# @deepseek-ai/dsh-tool-evolink-image

[English](README.md) | 中文

## 概述

此 Cordis 插件在 `ctx.tools` 注册 `generate_image`。它创建 EvoLink 图片任务，默认每五秒轮询一次状态，并返回已完成图片的 URL。

## 配置

插件从启动环境读取密钥。请在项目或 Harness home 的 `.env` 中设置 `EVOLINK_API_KEY=...`；进程继承的环境变量优先。不要将密钥写入 `cordis.yml`。

| 字段 | 默认值 | 含义 |
|---|---|---|
| `apiKeyEnv` | `EVOLINK_API_KEY` | 保存 API 密钥的环境变量。 |
| `baseUrl` | `https://api.evolink.ai/v1` | EvoLink API 根地址。 |
| `model` | `z-image-turbo` | 创建任务时使用的图片模型。 |
| `pollIntervalMs` | `5000` | 两次任务状态请求之间的间隔。 |
| `maxPollAttempts` | `60` | 创建任务后最多请求状态的次数。 |
| `requestTimeoutMs` | `30000` | 每次 HTTP 请求的超时。 |

共享基础 bundle 默认关闭 `tool-evolink-image` 行。它会出现在设置的插件清单中，且当前 profile 可在插件管理器中启用或关闭。基础 Web profile 会将全局工具排除在 Agent preset realm 之外；部署需要在 Web 会话中使用时，应在相应 preset 加入同一行。

## 模型体验

### 图片生成工具

#### 模型看到的内容

生成的[工具目录](../../../docs/tool-catalog.zh.md)说明 `generate_image`，包括 prompt、size、seed 与 `nsfw_check` 输入。成功调用会返回任务 id 与生成图片 URL。

#### Token 影响

插件启用时工具 schema 对模型可见。每次调用将渲染后的图片 URL 追加至会话。

#### KV Cache 影响

启用或关闭插件会改变后续请求中的工具 schema 部分。结果会追加至会话记录。

## 已知限制与延后工作

- EvoLink 结果 URL 由提供方管理且可能过期；需要持久化文件的调用方须另行保存。
