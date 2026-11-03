---
description: "Run HyperFrames lint, snapshot grids, and MP4 renders from DeepSeek Harness Agent Tools."
kind: "package-reference"
---

# @deepseek-ai/dsh-tool-hyperframes

English | [中文](README.zh.md)

## Summary

This Cordis plugin registers `video_lint`, `video_snapshot`, and `video_render` on `ctx.tools`. Each tool is a thin wrapper around the HyperFrames CLI: `video_lint` runs the static contract check and returns the parsed JSON report, `video_snapshot` captures frames at up to nine exact timeline times and tiles them into one grid image with three frames per row, and `video_render` encodes the project to an MP4 file. All three take the path to a HyperFrames project directory (a directory containing `index.html`).

The CLI runs through `npx --yes hyperframes` by default, so Node.js 22+ and network access to the package registry are required on first use. `video_render` additionally requires FFmpeg on `PATH`, which is a HyperFrames requirement for any video encoding. Grid tiling uses `sharp` and needs no system FFmpeg.

## Configuration

| Field | Default | Meaning |
|---|---|---|
| `command` | `npx` | Executable that launches the HyperFrames CLI. |
| `commandArgs` | `["--yes", "hyperframes"]` | Arguments inserted between `command` and the subcommand. |
| `lintTimeoutMs` | `120000` | Timeout for one `video_lint` call. |
| `snapshotTimeoutMs` | `300000` | Timeout for one `video_snapshot` call. |
| `renderTimeoutMs` | `1800000` | Timeout for one `video_render` call. |

The shared base bundle ships the `tool-hyperframes` row disabled. It appears in the Settings plugin inventory, and the Plugins manager can enable or disable it for the current profile. Base-backed Web profiles keep global tools out of Agent preset realms; add the same row to a preset when that deployment needs the tools in Web sessions.

## Model Experience

### Video tools

#### What the model sees

The generated [tool catalog](../../../docs/tool-catalog.md) describes all three tools. A successful `video_lint` call returns error and warning counts with each finding's code, severity, message, fix hint, and source location. A successful `video_snapshot` call returns the grid image path and the individual frame paths. A successful `video_render` call returns the MP4 path and its size in bytes.

#### Token effect

The three tool schemas are visible while the plugin is enabled. Each call appends its rendered report or file paths to the conversation; lint findings grow with the number of reported issues.

#### KV Cache effect

Enabling or disabling the plugin changes the tool-schema portion of a later request. Results append to the transcript.

## Known Limitations and Deferred Work

- The CLI is spawned without a shell, so on Windows the `npx` default cannot launch `npx.cmd`; configure `command` and `commandArgs` to a direct Node entry (for example `node` plus the HyperFrames CLI script path) on that platform.
- `video_render` fails with the HyperFrames diagnostic when FFmpeg is missing from `PATH`; install FFmpeg rather than working around it.
- When the frame count is not a multiple of three, the last grid row is filled with the dark background color instead of additional frames.
