---
description: "通过 DeepSeek Harness Agent Tool 运行 HyperFrames 的 lint 检查、截图九宫格与 MP4 渲染。"
kind: "package-reference"
---

# @deepseek-ai/dsh-tool-hyperframes

[English](README.md) | 中文

## 概要

本 Cordis 插件在 `ctx.tools` 上注册 `video_lint`、`video_snapshot` 和 `video_render`。三个工具都是 HyperFrames CLI 的轻量包装：`video_lint` 运行静态合约检查并返回解析后的 JSON 报告；`video_snapshot` 在最多 9 个精确时间点截取帧，并按每行 3 张拼成一张九宫格图片；`video_render` 将项目编码为 MP4 文件。三者都接收一个 HyperFrames 项目目录路径（该目录下必须有 `index.html`）。

CLI 默认通过 `npx --yes hyperframes` 运行，因此首次使用时需要 Node.js 22+ 和访问包注册表的网络。`video_render` 还要求 `PATH` 上有 FFmpeg，这是 HyperFrames 进行视频编码的自身要求。九宫格拼接使用 `sharp`，不依赖系统 FFmpeg。

## 配置

| 字段 | 默认值 | 含义 |
|---|---|---|
| `command` | `npx` | 启动 HyperFrames CLI 的可执行文件。 |
| `commandArgs` | `["--yes", "hyperframes"]` | 插入在 `command` 与子命令之间的参数。 |
| `lintTimeoutMs` | `120000` | 单次 `video_lint` 调用的超时时间。 |
| `snapshotTimeoutMs` | `300000` | 单次 `video_snapshot` 调用的超时时间。 |
| `renderTimeoutMs` | `1800000` | 单次 `video_render` 调用的超时时间。 |

共享 base bundle 默认以禁用状态发布 `tool-hyperframes` 行。它会出现在设置的插件清单中，插件管理器可以针对当前 profile 启用或禁用它。基于 base 的 Web profile 会将全局工具排除在 Agent preset realm 之外；当某个部署需要在 Web 会话中使用这些工具时，请在 preset 中添加相同的行。

## 模型体验

### 视频工具

#### 模型看到什么

生成的[工具目录](../../../docs/tool-catalog.zh.md)描述了全部三个工具。`video_lint` 调用成功时返回错误数和警告数，以及每条检查结果的代码、严重级别、消息、修复提示和源位置；`video_snapshot` 调用成功时返回九宫格图片路径和各帧路径；`video_render` 调用成功时返回 MP4 路径及其字节大小。

#### Token 影响

插件启用期间，三个工具的 schema 均可见。每次调用都会把渲染后的报告或文件路径追加到会话中；lint 结果条数越多，追加内容越长。

#### KV Cache 影响

启用或禁用插件会改变后续请求中的工具 schema 部分。调用结果追加到会话记录。

## 已知限制与待办

- CLI 以无 shell 方式派生，因此在 Windows 上默认的 `npx` 无法启动 `npx.cmd`；在该平台上请将 `command` 和 `commandArgs` 配置为直接的 Node 入口（例如 `node` 加 HyperFrames CLI 脚本路径）。
- 当 `PATH` 上缺少 FFmpeg 时，`video_render` 会以 HyperFrames 的诊断信息失败；请安装 FFmpeg 而不是绕过该要求。
- 当帧数不是 3 的倍数时，九宫格最后一行的空位以深色背景填充，而不是追加额外的帧。
