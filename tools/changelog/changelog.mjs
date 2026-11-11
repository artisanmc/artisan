#!/usr/bin/env node
// Changelog fragments: each PR adds its entry as a file in changelog.d/ instead of editing
// CHANGELOG.md, so two PRs never touch the same lines. A release folds the fragments into
// CHANGELOG.md. See changelog.d/README.md.
//
//   node tools/changelog/changelog.mjs check [--base <ref>]   validate fragments; with --base, refuse
//                                                              lines added to [Unreleased] since <ref>
//   node tools/changelog/changelog.mjs preview                 print the entries the next release adds
//   node tools/changelog/changelog.mjs release <version> [--date YYYY-MM-DD]
//                                                              fold fragments in, date the section, delete them

import { execFileSync } from 'node:child_process'
import { existsSync, readdirSync, readFileSync, statSync, unlinkSync, writeFileSync } from 'node:fs'
import { join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

export const CATEGORIES = ['Added', 'Changed', 'Deprecated', 'Removed', 'Fixed', 'Security']
const UNRELEASED = '## [Unreleased]'
const FRAGMENT_NAME = /^[a-z0-9][a-z0-9._-]*\.md$/
const FIRST_LINE = new RegExp(`^- \\*\\*(${CATEGORIES.join('|')})\\*\\*( \\([a-z ]+\\))?: \\S`)

/** Problems of one fragment's name and text; empty when it is valid. */
export function fragmentProblems(name, text) {
  const problems = []
  if (!FRAGMENT_NAME.test(name)) problems.push('name must be lowercase letters, digits, `.`, `_` or `-`, ending in `.md`')
  const lines = text.replace(/\s+$/, '').split('\n')
  if (lines.length === 1 && lines[0] === '') return [...problems, 'is empty']
  for (const [i, line] of lines.entries()) {
    if (!line.startsWith('- ')) {
      if (i === 0) problems.push('must start with a `- ` entry')
      continue
    }
    if (!FIRST_LINE.test(line)) {
      problems.push(`line ${i + 1}: an entry starts with \`- **<Category>**: \`, Category one of ${CATEGORIES.join(', ')}`)
    }
  }
  return problems
}

/** Start and end (exclusive) line indexes of the [Unreleased] body. */
export function unreleasedRange(lines) {
  const head = lines.indexOf(UNRELEASED)
  if (head < 0) throw new Error(`CHANGELOG.md has no "${UNRELEASED}" heading`)
  let end = head + 1
  while (end < lines.length && !lines[end].startsWith('## ')) end++
  return [head + 1, end]
}

/** Lines of `head`'s [Unreleased] body that `base`'s does not have. */
export function addedUnreleasedLines(base, head) {
  const body = (text) => {
    const lines = text.split('\n')
    const [from, to] = unreleasedRange(lines)
    return lines.slice(from, to)
  }
  const before = new Set(body(base))
  return body(head).filter((line) => line.trim() !== '' && !before.has(line))
}

/**
 * The changelog with `entries` (fragment texts, newest first) at the top of [Unreleased], that
 * section renamed `[version] - date`, and a new empty [Unreleased] above it.
 */
export function release(changelog, entries, version, date) {
  const lines = changelog.split('\n')
  const [from, to] = unreleasedRange(lines)
  const body = lines.slice(from, to)
  while (body.length && body[0].trim() === '') body.shift()
  const added = entries.map((e) => e.replace(/\s+$/, ''))
  const section = [`## [${version}] - ${date}`, '', ...added, ...body]
  if (section[section.length - 1].trim() !== '') section.push('')
  return [...lines.slice(0, from - 1), UNRELEASED, '', ...section, ...lines.slice(to)].join('\n')
}

function git(root, ...args) {
  return execFileSync('git', args, { cwd: root, encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] })
}

/** Fragments of `dir`, newest first: by the commit that added each, else (not committed) its mtime. */
function readFragments(root, dir) {
  if (!existsSync(dir)) return []
  return readdirSync(dir)
    .filter((name) => name.endsWith('.md') && name !== 'README.md')
    .map((name) => {
      const path = join(dir, name)
      let time = 0
      try {
        time = Number(git(root, 'log', '--diff-filter=A', '--format=%ct', '-1', '--', path).trim()) * 1000
      } catch {}
      if (!time) time = statSync(path).mtimeMs
      return { name, path, time, text: readFileSync(path, 'utf8') }
    })
    .sort((a, b) => b.time - a.time || a.name.localeCompare(b.name))
}

function main(argv) {
  const root = resolve(fileURLToPath(import.meta.url), '../../..')
  const dir = join(root, 'changelog.d')
  const changelogPath = join(root, 'CHANGELOG.md')
  const [command, ...rest] = argv
  const option = (flag) => {
    const i = rest.indexOf(flag)
    return i < 0 ? undefined : rest[i + 1]
  }
  const fragments = readFragments(root, dir)
  const problems = fragments.flatMap((f) => fragmentProblems(f.name, f.text).map((p) => `changelog.d/${f.name}: ${p}`))

  if (command === 'check') {
    const base = option('--base')
    if (base) {
      const added = addedUnreleasedLines(git(root, 'show', `${base}:CHANGELOG.md`), readFileSync(changelogPath, 'utf8'))
      if (added.length) {
        problems.push(
          `CHANGELOG.md: ${added.length} line(s) added to [Unreleased]. Put the entry in a new file of changelog.d/ instead (see changelog.d/README.md):\n` +
            added.map((l) => `    ${l.slice(0, 120)}`).join('\n'),
        )
      }
    }
    if (problems.length) {
      console.error(problems.join('\n'))
      return 1
    }
    console.log(`changelog: ${fragments.length} fragment(s) OK`)
    return 0
  }
  if (command === 'preview') {
    for (const f of fragments) console.log(f.text.replace(/\s+$/, ''))
    return problems.length ? (console.error(problems.join('\n')), 1) : 0
  }
  if (command === 'release') {
    const version = rest[0]
    const date = option('--date') ?? new Date().toISOString().slice(0, 10)
    if (!version || version.startsWith('--')) throw new Error('usage: release <version> [--date YYYY-MM-DD]')
    if (problems.length) {
      console.error(problems.join('\n'))
      return 1
    }
    const changelog = readFileSync(changelogPath, 'utf8')
    writeFileSync(changelogPath, release(changelog, fragments.map((f) => f.text), version, date))
    for (const f of fragments) unlinkSync(f.path)
    console.log(`CHANGELOG.md: [${version}] - ${date}, ${fragments.length} fragment(s) folded in and deleted`)
    return 0
  }
  console.error('usage: changelog.mjs check [--base <ref>] | preview | release <version> [--date YYYY-MM-DD]')
  return 2
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  process.exitCode = main(process.argv.slice(2))
}
