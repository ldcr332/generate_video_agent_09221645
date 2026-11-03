// Fake HyperFrames CLI for tests: `node fake-hyperframes.mjs <subcommand> <dir> ...`.
// Behavior is selected with FIXTURE_MODE: ok (default) or fail.
import fs from 'node:fs'
import path from 'node:path'

const ONE_BY_ONE_PNG = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==',
  'base64',
)

const [, , subcommand, dir, ...rest] = process.argv
const flag = (name) => {
  const index = rest.indexOf(name)
  return index === -1 ? undefined : rest[index + 1]
}

if (process.env.FIXTURE_MODE === 'fail') {
  process.stderr.write('FFmpeg not found\n')
  process.exit(1)
}

if (process.env.FIXTURE_LOG) {
  fs.appendFileSync(process.env.FIXTURE_LOG, JSON.stringify(process.argv.slice(2)) + '\n')
}

if (subcommand === 'lint') {
  process.stdout.write(JSON.stringify({
    ok: false,
    errorCount: 1,
    warningCount: 1,
    findings: [
      { code: 'missing_timeline_registry', severity: 'error', message: 'Missing registration.', fixHint: 'Register it.', file: path.join(dir, 'index.html'), line: 3 },
      { code: 'studio_missing_editable_id', severity: 'warning', message: 'No stable id.' },
    ],
    filesScanned: 1,
  }))
  process.exit(1)
}

if (subcommand === 'snapshot') {
  const outDir = flag('-o')
  const times = flag('--at').split(',')
  fs.mkdirSync(outDir, { recursive: true })
  times.forEach((time, index) => {
    fs.writeFileSync(path.join(outDir, `frame-${String(index).padStart(2, '0')}-at-${time}s.png`), ONE_BY_ONE_PNG)
  })
  fs.writeFileSync(path.join(outDir, 'contact-sheet.jpg'), 'decoy')
  process.exit(0)
}

if (subcommand === 'render') {
  const output = flag('-o')
  fs.mkdirSync(path.dirname(output), { recursive: true })
  fs.writeFileSync(output, 'fake mp4 bytes')
  process.exit(0)
}

process.stderr.write(`unknown subcommand: ${subcommand}\n`)
process.exit(2)
