import * as core from '@actions/core'
import { context } from '@actions/github'
import { getTapOctokit } from './auth.js'
import { resolvePlatform } from './assets.js'
import type { SourceRepo } from './assets.js'
import { resolveMetadata } from './metadata.js'
import { mergeEntries, parseFormula, renderFormula } from './formula.js'
import type { FormulaMetadata, PlatformEntry } from './formula.js'
import { ALL_PLATFORMS, platformKey } from './platforms.js'
import type { Arch, Os, Platform } from './platforms.js'
import { readFormula, updateFormula } from './tap.js'
import type { TapRepo } from './tap.js'
import { getReleaseTag, versionFromTag, versionSeries } from './version.js'

const SUPPORTED_OS: readonly string[] = ['darwin', 'linux']

interface FormulaTarget {
  formula: string
  kegOnly: boolean
}

/**
 * Resolve the set of formulae to publish: always the unversioned `name`, plus
 * any major/minor versioned aliases requested via the `aliases` input (e.g.
 * `name@3`, `name@3.11`). Versioned aliases are keg-only so they can coexist
 * with the unversioned formula.
 */
function resolveFormulaTargets(name: string, version: string): FormulaTarget[] {
  const requested = new Set(
    core
      .getInput('aliases')
      .split(/[\s,]+/)
      .map((value) => value.trim().toLowerCase())
      .filter(Boolean)
  )

  const targets: FormulaTarget[] = [{ formula: name, kegOnly: false }]
  if (requested.size === 0) {
    return targets
  }

  const { major, minor } = versionSeries(version)
  const unknown = [...requested].filter((a) => a !== 'major' && a !== 'minor')
  if (unknown.length) {
    throw new Error(
      `Unknown alias(es): ${unknown.join(', ')}. Supported: major, minor.`
    )
  }
  if (requested.has('major') && major) {
    targets.push({ formula: `${name}@${major}`, kegOnly: true })
  }
  if (requested.has('minor') && minor) {
    targets.push({ formula: `${name}@${minor}`, kegOnly: true })
  }
  return targets
}

function parseRepo(slug: string): { owner: string; repo: string } {
  const [owner, repo] = slug.split('/')
  if (!owner || !repo) {
    throw new Error(`Expected an "owner/repo" value but received "${slug}".`)
  }
  return { owner, repo }
}

/**
 * Determine which platforms this invocation should resolve. When `os`/`arch`
 * inputs are given we target exactly that platform (the per-matrix-job mode);
 * otherwise we scan every supported platform and pick up whatever is present.
 * Returns null to signal an intentional no-op (e.g. a Windows matrix job).
 */
function resolveTargets(): Platform[] | null {
  const os = core.getInput('os').trim().toLowerCase()
  const arch = core.getInput('arch').trim().toLowerCase()

  if (!os && !arch) {
    return [...ALL_PLATFORMS]
  }
  if (!os || !arch) {
    throw new Error('Both `os` and `arch` must be provided together.')
  }
  if (!SUPPORTED_OS.includes(os)) {
    core.info(`OS "${os}" is not a Homebrew platform; nothing to do.`)
    return null
  }
  if (arch !== 'amd64' && arch !== 'arm64') {
    throw new Error(`Unsupported arch "${arch}"; expected amd64 or arm64.`)
  }
  return [{ os: os as Os, arch: arch as Arch }]
}

export async function run(): Promise<void> {
  try {
    const appId = core.getInput('app-id', { required: true })
    const privateKey = core.getInput('private-key', { required: true })

    const source: SourceRepo = parseRepo(
      core.getInput('repository') ||
        `${context.repo.owner}/${context.repo.repo}`
    )

    const name = core.getInput('name') || source.repo
    const binary = core.getInput('binary') || name
    const formulaDir = core.getInput('formula-dir') || 'Formula'

    const tag = getReleaseTag()
    const version = versionFromTag(tag)
    core.info(
      `Publishing ${name} ${version} (tag ${tag}) from ${source.owner}/${source.repo}`
    )

    const platformTargets = resolveTargets()
    if (platformTargets === null) {
      return
    }

    const updates = new Map<string, PlatformEntry>()
    for (const platform of platformTargets) {
      const entry = await resolvePlatform(source, tag, name, platform)
      if (entry) {
        updates.set(platformKey(platform), entry)
      }
    }

    if (updates.size === 0) {
      core.warning(
        `No release assets are available for ${name} ${tag} yet; leaving the formula unchanged.`
      )
      return
    }

    const githubToken =
      core.getInput('github-token') || process.env.GITHUB_TOKEN || undefined
    const metadata = await resolveMetadata(
      source,
      name,
      {
        desc: core.getInput('desc') || undefined,
        homepage: core.getInput('homepage') || undefined,
        license: core.getInput('license') || undefined
      },
      githubToken
    )

    const tap: TapRepo = {
      ...parseRepo(core.getInput('tap') || 'SierraSoftworks/homebrew-tap'),
      branch: core.getInput('tap-branch') || undefined
    }

    const octokit = await getTapOctokit(
      { appId, privateKey },
      tap.owner,
      tap.repo
    )

    const platformList = [...updates.keys()].sort().join(', ')
    const basePath = `${formulaDir}/${name}.rb`

    // Resolve the formula metadata once, falling back to whatever the tap's
    // unversioned formula already records so a missing metadata read (e.g. a
    // rate-limited 403) never blocks an update. These values are shared by the
    // unversioned formula and every versioned alias.
    const baseExisting = parseFormula(
      (await readFormula(octokit, tap, basePath)) || ''
    )
    const desc = metadata.desc || baseExisting.desc
    if (!desc) {
      throw new Error(
        `No usable description for ${name}. Pass \`github-token\` so the ` +
          'source repository description can be read, or set `desc`.'
      )
    }
    const homepage =
      metadata.homepage ||
      baseExisting.homepage ||
      `https://github.com/${source.owner}/${source.repo}`
    const license = metadata.license || baseExisting.license

    // The unversioned formula plus any requested major/minor aliases.
    const formulaTargets = resolveFormulaTargets(name, version)
    const written: string[] = []
    let anyUpdated = false

    for (const target of formulaTargets) {
      const path = `${formulaDir}/${target.formula}.rb`
      const message = `${target.formula}: ${version} (${platformList})`
      const result = await updateFormula(
        octokit,
        tap,
        path,
        message,
        (current) => {
          const existing = current ? parseFormula(current) : null
          const meta: FormulaMetadata = {
            name: target.formula,
            binary,
            version,
            desc,
            homepage,
            license,
            kegOnly: target.kegOnly
          }
          return renderFormula(meta, mergeEntries(existing, version, updates))
        }
      )
      core.info(`${path}: ${result}`)
      written.push(path)
      anyUpdated = anyUpdated || result === 'updated'
    }

    core.setOutput('formula', basePath)
    core.setOutput('formulae', written.join('\n'))
    core.setOutput('version', version)
    core.setOutput('platforms', platformList)
    core.setOutput('result', anyUpdated ? 'updated' : 'unchanged')
  } catch (error) {
    if (error instanceof Error) {
      core.setFailed(error.message)
      if (error.stack) {
        core.error(error.stack)
      }
    } else {
      core.setFailed(String(error))
    }
  }
}
