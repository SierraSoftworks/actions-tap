/**
 * Pure logic for parsing, merging, and rendering Homebrew formulae.
 *
 * Formulae are rendered with a machine-readable `# tap:{os}-{arch}` marker above
 * each platform block so that a later, incremental invocation of the action can
 * re-parse its own output and update a single platform without disturbing the
 * others. This is what makes per-matrix-job updates idempotent and safe.
 */

import { ALL_PLATFORMS, parsePlatformKey, platformKey } from './platforms.js'
import type { Platform } from './platforms.js'

export interface PlatformEntry {
  url: string
  sha256: string
}

export interface ParsedFormula {
  version?: string
  desc?: string
  homepage?: string
  license?: string
  entries: Map<string, PlatformEntry>
}

export interface FormulaMetadata {
  name: string
  binary: string
  version: string
  desc: string
  homepage?: string
  license?: string
  // Versioned alias formulae (e.g. `git-tool@3`) are keg-only so they can
  // coexist with the unversioned formula without link conflicts.
  kegOnly?: boolean
}

/**
 * Convert a formula name into its Ruby class name, mirroring Homebrew's
 * `Formulary.class_s` (e.g. `git-tool` -> `GitTool`, `on-call` -> `OnCall`,
 * `foo@2` -> `FooAT2`).
 */
export function formulaClassName(name: string): string {
  let s = name.charAt(0).toUpperCase() + name.slice(1).toLowerCase()
  s = s.replace(/[-_.\s]([a-zA-Z0-9])/g, (_, c: string) => c.toUpperCase())
  s = s.replace(/\+/g, 'x')
  s = s.replace(/(.)@(\d)/g, '$1AT$2')
  return s
}

/**
 * Normalise a project description into something `brew audit --strict` accepts:
 * single line, no surrounding whitespace, no leading article, no leading copy of
 * the formula name, no trailing punctuation, capitalised, and at most 80
 * characters (trimmed at a word boundary).
 */
export function sanitizeDesc(desc: string, name?: string): string {
  let d = (desc || '').trim().replace(/\s+/g, ' ')
  d = d.replace(/[.!]+$/, '')
  d = d.replace(/^(an?|the)\s+/i, '')
  if (name) {
    const escaped = name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
    d = d.replace(new RegExp(`^${escaped}[\\s:-]+`, 'i'), '')
  }
  if (d.length > 0) {
    d = d.charAt(0).toUpperCase() + d.slice(1)
  }
  if (d.length > 80) {
    d = d
      .slice(0, 80)
      .replace(/\s+\S*$/, '')
      .trimEnd()
  }
  return d
}

/**
 * Parse a previously-rendered formula, extracting its version and the
 * per-platform url/sha256 entries keyed off the `# tap:{os}-{arch}` markers.
 * Unknown formats simply yield no entries, so a fresh formula is generated.
 */
export function parseFormula(content: string): ParsedFormula {
  const version = content.match(/^\s*version\s+"([^"]+)"/m)?.[1]
  const desc = content.match(/^\s*desc\s+"([^"]+)"/m)?.[1]
  const homepage = content.match(/^\s*homepage\s+"([^"]+)"/m)?.[1]
  const license = content.match(/^\s*license\s+"([^"]+)"/m)?.[1]

  const entries = new Map<string, PlatformEntry>()
  const re =
    /#\s*tap:([a-z0-9]+-[a-z0-9]+)\s*\n\s*url\s+"([^"]+)"\s*\n\s*sha256\s+"([0-9a-f]+)"/g
  let match: RegExpExecArray | null
  while ((match = re.exec(content)) !== null) {
    if (parsePlatformKey(match[1])) {
      entries.set(match[1], { url: match[2], sha256: match[3] })
    }
  }

  return { version, desc, homepage, license, entries }
}

/**
 * Merge freshly-resolved platform entries into whatever the tap currently holds.
 *
 * When `authoritative` is true the caller scanned every supported platform, so
 * `updates` is the complete set of assets the release actually publishes: we
 * never carry existing entries over, which prunes platforms whose assets are no
 * longer published (a removed asset, or one the build simply never produced).
 *
 * In the incremental per-platform mode (`authoritative` false) we only resolved
 * a single platform, so we preserve the existing formula's other platforms when
 * the version is unchanged; a version change starts fresh so stale checksums
 * never linger. Either way this run's entries win for the platforms it covers.
 */
export function mergeEntries(
  existing: ParsedFormula | null,
  targetVersion: string,
  updates: Map<string, PlatformEntry>,
  authoritative: boolean
): Map<string, PlatformEntry> {
  const merged = new Map<string, PlatformEntry>()
  if (!authoritative && existing && existing.version === targetVersion) {
    for (const [key, value] of existing.entries) {
      merged.set(key, value)
    }
  }
  for (const [key, value] of updates) {
    merged.set(key, value)
  }
  return merged
}

function renderPlatformBlock(
  platform: Platform,
  entry: PlatformEntry,
  indent: string
): string {
  const macro = platform.arch === 'arm64' ? 'on_arm' : 'on_intel'
  return [
    `${indent}${macro} do`,
    `${indent}  # tap:${platformKey(platform)}`,
    `${indent}  url "${entry.url}"`,
    `${indent}  sha256 "${entry.sha256}"`,
    `${indent}end`
  ].join('\n')
}

function renderOsBlock(
  os: Platform['os'],
  entries: Map<string, PlatformEntry>
): string | null {
  const platforms = ALL_PLATFORMS.filter(
    (platform) => platform.os === os && entries.has(platformKey(platform))
  )
  if (platforms.length === 0) {
    return null
  }

  const macro = os === 'darwin' ? 'on_macos' : 'on_linux'
  const inner = platforms
    .map((platform) =>
      renderPlatformBlock(platform, entries.get(platformKey(platform))!, '    ')
    )
    .join('\n')
  return `  ${macro} do\n${inner}\n  end`
}

/**
 * Render a complete formula from metadata plus the merged platform entries.
 * Only platforms present in `entries` are emitted, so partial releases produce a
 * valid (if incomplete) formula that later invocations fill in.
 */
export function renderFormula(
  meta: FormulaMetadata,
  entries: Map<string, PlatformEntry>
): string {
  const lines: string[] = []
  lines.push(`class ${formulaClassName(meta.name)} < Formula`)
  lines.push(`  desc "${meta.desc}"`)
  if (meta.homepage) {
    lines.push(`  homepage "${meta.homepage}"`)
  }
  lines.push(`  version "${meta.version}"`)
  if (meta.license) {
    lines.push(`  license "${meta.license}"`)
  }
  if (meta.kegOnly) {
    lines.push('  keg_only :versioned_formula')
  }
  lines.push('')

  const osBlocks = (['darwin', 'linux'] as const)
    .map((os) => renderOsBlock(os, entries))
    .filter((block): block is string => block !== null)
  for (const block of osBlocks) {
    lines.push(block)
    lines.push('')
  }

  lines.push('  def install')
  lines.push(`    bin.install Dir["*"][0] => "${meta.binary}"`)
  lines.push('  end')
  lines.push('')
  lines.push('  test do')
  lines.push(
    `    assert_match version.to_s, shell_output("#{bin}/${meta.binary} --version 2>&1 || true")`
  )
  lines.push('  end')
  lines.push('end')

  return lines.join('\n') + '\n'
}
