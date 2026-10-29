import assert from 'node:assert/strict'
import { test } from 'node:test'
import { addedUnreleasedLines, fragmentProblems, release } from './changelog.mjs'

const CHANGELOG = `# Changelog

Intro.

## [Unreleased]

- **Fixed**: old entry.
  - detail

## [1.0.0-alpha] - 2026-05-25

- **Added**: first.
`

test('a valid fragment has no problem', () => {
  assert.deepEqual(fragmentProblems('fix-deploy.md', '- **Fixed**: deploy.\n  - detail\n'), [])
  assert.deepEqual(fragmentProblems('mcp.md', '- **Added** (preview): MCP.\n- **Changed**: guide.\n'), [])
})

test('a fragment must name a known category and be named in lowercase', () => {
  assert.equal(fragmentProblems('Fix.md', '- **Fixed**: x\n').length, 1)
  assert.equal(fragmentProblems('x.md', '- **Plugin**: x\n').length, 1)
  assert.equal(fragmentProblems('x.md', 'Fixed: x\n').length, 1)
  assert.equal(fragmentProblems('x.md', '\n').length, 1)
})

test('lines added to [Unreleased] are reported, edits elsewhere are not', () => {
  const head = CHANGELOG.replace('## [Unreleased]\n', '## [Unreleased]\n\n- **Added**: new.\n')
  assert.deepEqual(addedUnreleasedLines(CHANGELOG, head), ['- **Added**: new.'])
  assert.deepEqual(addedUnreleasedLines(CHANGELOG, CHANGELOG.replace('first.', 'first one.')), [])
})

test('release puts the fragments first, dates the section and opens an empty [Unreleased]', () => {
  const out = release(CHANGELOG, ['- **Added**: newest.\n', '- **Changed**: older.\n'], '1.0.0', '2026-11-01')
  assert.equal(
    out,
    `# Changelog

Intro.

## [Unreleased]

## [1.0.0] - 2026-11-01

- **Added**: newest.
- **Changed**: older.
- **Fixed**: old entry.
  - detail

## [1.0.0-alpha] - 2026-05-25

- **Added**: first.
`,
  )
  // A release PR adds nothing to [Unreleased], so the CI check lets it through.
  assert.deepEqual(addedUnreleasedLines(CHANGELOG, out), [])
})
