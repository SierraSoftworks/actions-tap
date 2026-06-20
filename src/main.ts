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
import { updateFormula } from './tap.js'
import type { TapRepo } from './tap.js'
import { getReleaseTag, versionFromTag } from './version.js'

const SUPPORTED_OS: readonly string[] = ['darwin', 'linux']

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

    const targets = resolveTargets()
    if (targets === null) {
      return
    }

    const updates = new Map<string, PlatformEntry>()
    for (const platform of targets) {
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

    const meta: FormulaMetadata = {
      name,
      binary,
      version,
      desc: metadata.desc,
      homepage: metadata.homepage,
      license: metadata.license
    }

    const tap: TapRepo = {
      ...parseRepo(core.getInput('tap') || 'SierraSoftworks/homebrew-tap'),
      branch: core.getInput('tap-branch') || undefined
    }

    const octokit = await getTapOctokit(
      { appId, privateKey },
      tap.owner,
      tap.repo
    )

    const path = `${formulaDir}/${name}.rb`
    const platformList = [...updates.keys()].sort().join(', ')
    const message = `${name}: ${version} (${platformList})`

    const result = await updateFormula(
      octokit,
      tap,
      path,
      message,
      (current) => {
        const existing = current ? parseFormula(current) : null
        const merged = mergeEntries(existing, version, updates)
        return renderFormula(meta, merged)
      }
    )

    core.setOutput('formula', path)
    core.setOutput('version', version)
    core.setOutput('platforms', platformList)
    core.setOutput('result', result)
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
