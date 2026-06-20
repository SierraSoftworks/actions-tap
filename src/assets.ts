import * as core from '@actions/core'
import { createHash } from 'crypto'
import { assetName, platformKey } from './platforms.js'
import type { Platform } from './platforms.js'
import type { PlatformEntry } from './formula.js'

export interface SourceRepo {
  owner: string
  repo: string
}

/** Build the public download URL for a release asset. */
export function assetUrl(
  source: SourceRepo,
  tag: string,
  name: string
): string {
  return `https://github.com/${source.owner}/${source.repo}/releases/download/${tag}/${name}`
}

/**
 * Resolve a platform entry by downloading its release asset and hashing it.
 * Returns null (with a warning) when the asset does not exist yet, so a partial
 * release simply skips the missing platforms rather than failing the run.
 *
 * Source repositories are public, so assets are fetched unauthenticated.
 */
export async function resolvePlatform(
  source: SourceRepo,
  tag: string,
  app: string,
  platform: Platform
): Promise<PlatformEntry | null> {
  const name = assetName(app, platform)
  const url = assetUrl(source, tag, name)

  core.debug(`Fetching asset ${name} from ${url}`)
  const response = await fetch(url)

  if (response.status === 404) {
    core.warning(
      `Release asset ${name} is not available for ${tag} yet; skipping ${platformKey(platform)}.`
    )
    return null
  }
  if (!response.ok) {
    throw new Error(
      `Failed to download ${url}: ${response.status} ${response.statusText}`
    )
  }

  const data = Buffer.from(await response.arrayBuffer())
  const sha256 = createHash('sha256').update(data).digest('hex')
  core.info(
    `Resolved ${platformKey(platform)} (${data.length} bytes, ${sha256})`
  )

  return { url, sha256 }
}
