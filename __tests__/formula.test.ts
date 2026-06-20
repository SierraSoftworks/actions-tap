import { describe, it, expect } from '@jest/globals'
import {
  formulaClassName,
  sanitizeDesc,
  parseFormula,
  mergeEntries,
  renderFormula
} from '../src/formula'
import type { FormulaMetadata, PlatformEntry } from '../src/formula'

const META: FormulaMetadata = {
  name: 'git-tool',
  binary: 'git-tool',
  version: '3.9.8',
  desc: 'Manage your Git repositories in a consistent folder structure',
  homepage: 'https://git-tool.sierrasoftworks.com',
  license: 'MIT'
}

const base =
  'https://github.com/SierraSoftworks/git-tool/releases/download/v3.9.8'
const entry = (suffix: string): PlatformEntry => ({
  url: `${base}/git-tool-${suffix}`,
  sha256: 'a'.repeat(64)
})

function allEntries(): Map<string, PlatformEntry> {
  return new Map([
    ['darwin-arm64', entry('darwin-arm64')],
    ['darwin-amd64', entry('darwin-amd64')],
    ['linux-arm64', entry('linux-arm64')],
    ['linux-amd64', entry('linux-amd64')]
  ])
}

describe('formulaClassName', () => {
  it.each([
    ['git-tool', 'GitTool'],
    ['github-backup', 'GithubBackup'],
    ['on-call', 'OnCall'],
    ['mail-backup', 'MailBackup'],
    ['imgsort', 'Imgsort'],
    ['grey', 'Grey'],
    ['tailservice', 'Tailservice'],
    ['foo@2', 'FooAT2'],
    ['c++tool', 'Cxxtool']
  ])('maps %s -> %s', (input, expected) => {
    expect(formulaClassName(input)).toBe(expected)
  })
})

describe('sanitizeDesc', () => {
  it('strips a leading article', () => {
    expect(sanitizeDesc('A powerful tool for repos')).toBe(
      'Powerful tool for repos'
    )
    expect(sanitizeDesc('The best widget')).toBe('Best widget')
  })

  it('strips a trailing period and collapses whitespace', () => {
    expect(sanitizeDesc('  Does   a thing.  ')).toBe('Does a thing')
  })

  it('strips a leading copy of the formula name', () => {
    expect(sanitizeDesc('git-tool: manage your repos', 'git-tool')).toBe(
      'Manage your repos'
    )
  })

  it('truncates to 80 characters on a word boundary', () => {
    const long =
      'This description is intentionally written to be quite a lot longer than eighty characters in total'
    const result = sanitizeDesc(long)
    expect(result.length).toBeLessThanOrEqual(80)
    // The truncated result must be a whole-word prefix of the original.
    expect(`${long} `.startsWith(`${result} `)).toBe(true)
    expect(result.endsWith('eighty')).toBe(true)
  })

  it('returns an empty string for empty input', () => {
    expect(sanitizeDesc('')).toBe('')
  })
})

describe('renderFormula / parseFormula round-trip', () => {
  it('renders a complete, parseable formula', () => {
    const rendered = renderFormula(META, allEntries())
    expect(rendered).toContain('class GitTool < Formula')
    expect(rendered).toContain('on_macos do')
    expect(rendered).toContain('on_linux do')
    expect(rendered).toContain('# tap:darwin-arm64')
    expect(rendered).toContain('bin.install Dir["*"][0] => "git-tool"')

    const parsed = parseFormula(rendered)
    expect(parsed.version).toBe('3.9.8')
    expect(parsed.desc).toBe(META.desc)
    expect(parsed.homepage).toBe(META.homepage)
    expect(parsed.license).toBe('MIT')
    expect(parsed.entries.size).toBe(4)
    expect(parsed.entries.get('darwin-arm64')?.url).toBe(
      `${base}/git-tool-darwin-arm64`
    )
  })

  it('omits platforms (and empty os blocks) that have no entry', () => {
    const partial = new Map([['darwin-arm64', entry('darwin-arm64')]])
    const rendered = renderFormula(META, partial)
    expect(rendered).toContain('on_macos do')
    expect(rendered).toContain('on_arm do')
    expect(rendered).not.toContain('on_intel do')
    expect(rendered).not.toContain('on_linux do')
    expect(parseFormula(rendered).entries.size).toBe(1)
  })

  it('omits the license line when unknown', () => {
    const rendered = renderFormula(
      { ...META, license: undefined },
      allEntries()
    )
    expect(rendered).not.toContain('license')
  })
})

describe('mergeEntries (incremental, idempotent)', () => {
  it('preserves sibling platforms when the version is unchanged', () => {
    const existing = parseFormula(renderFormula(META, allEntries()))
    const update = new Map([
      [
        'linux-amd64',
        { url: `${base}/git-tool-linux-amd64`, sha256: 'b'.repeat(64) }
      ]
    ])
    const merged = mergeEntries(existing, '3.9.8', update)
    expect(merged.size).toBe(4)
    expect(merged.get('linux-amd64')?.sha256).toBe('b'.repeat(64))
    expect(merged.get('darwin-arm64')?.sha256).toBe('a'.repeat(64))
  })

  it('is idempotent: re-applying the same update yields the same result', () => {
    const existing = parseFormula(renderFormula(META, allEntries()))
    const update = new Map([['darwin-arm64', entry('darwin-arm64')]])
    const merged = mergeEntries(existing, '3.9.8', update)
    expect(renderFormula(META, merged)).toBe(renderFormula(META, allEntries()))
  })

  it('resets stale platforms when the version changes', () => {
    const existing = parseFormula(renderFormula(META, allEntries()))
    const update = new Map([['darwin-arm64', entry('darwin-arm64')]])
    const merged = mergeEntries(existing, '4.0.0', update)
    expect(merged.size).toBe(1)
    expect([...merged.keys()]).toEqual(['darwin-arm64'])
  })

  it('starts fresh when no formula exists yet', () => {
    const update = new Map([['darwin-arm64', entry('darwin-arm64')]])
    const merged = mergeEntries(null, '3.9.8', update)
    expect(merged.size).toBe(1)
  })
})
