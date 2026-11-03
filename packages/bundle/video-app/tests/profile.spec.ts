/** The video bundle must carry one parseable layer: the studio UI plus the media tool flips. */

import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { resolve } from 'node:path'
import { describe, expect, it } from 'vitest'
import * as yaml from 'js-yaml'
import { entryListSchema } from '@deepseek-ai/cordis-plugin-include'

interface PatchEntry {
  id?: string
  name?: string
  disabled?: boolean
  insert?: { id?: string; name?: string }[]
}

describe('video-app bundle', () => {
  it('declares a public parseable layer with the studio UI and the media tool flips', () => {
    const root = fileURLToPath(new URL('..', import.meta.url))
    const manifest = JSON.parse(readFileSync(resolve(root, 'package.json'), 'utf8')) as {
      private?: boolean
      publishConfig?: { access?: string }
      dependencies?: Record<string, string>
      dsh?: { bundle?: { patch?: string } }
    }
    expect(manifest.private).toBeUndefined()
    expect(manifest.publishConfig?.access).toBe('public')
    expect(manifest.dsh?.bundle?.patch).toBe('./cordis.patch.yml')
    expect(manifest.dependencies).toEqual({
      '@deepseek-ai/dsh-client-ui-video': 'workspace:^',
    })

    const parsed = yaml.load(
      readFileSync(resolve(root, manifest.dsh!.bundle!.patch!), 'utf8'),
      { schema: entryListSchema },
    ) as PatchEntry[]
    expect(parsed.flatMap(patch => patch.insert ?? [])).toEqual([
      { id: 'ui-video', name: '@deepseek-ai/dsh-client-ui-video' },
    ])
    expect(parsed.filter(patch => patch.id !== undefined && patch.insert === undefined)).toEqual([
      { id: 'tool-tts', disabled: false },
      { id: 'tool-hyperframes', disabled: false },
    ])
  })
})
