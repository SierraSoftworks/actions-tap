import * as core from '@actions/core'
import { sanitizeDesc } from './formula.js'
import type { SourceRepo } from './assets.js'

export interface ResolvedMetadata {
  desc: string
  homepage?: string
  license?: string
}

interface RepoApiResponse {
  description?: string | null
  homepage?: string | null
  license?: { spdx_id?: string | null } | null
}

/**
 * Resolve formula metadata for a project, defaulting to the source repository's
 * GitHub metadata (description, homepage, license) and letting explicit inputs
 * override any field. The description is always sanitised for `brew audit`.
 *
 * Repositories are public, so metadata is read unauthenticated; failures fall
 * back to whatever overrides were supplied.
 */
export async function resolveMetadata(
  source: SourceRepo,
  name: string,
  overrides: { desc?: string; homepage?: string; license?: string }
): Promise<ResolvedMetadata> {
  let fetched: RepoApiResponse = {}
  try {
    const response = await fetch(
      `https://api.github.com/repos/${source.owner}/${source.repo}`,
      { headers: { Accept: 'application/vnd.github+json' } }
    )
    if (response.ok) {
      fetched = (await response.json()) as RepoApiResponse
    } else {
      core.warning(
        `Could not read ${source.owner}/${source.repo} metadata (${response.status}); relying on inputs.`
      )
    }
  } catch (error) {
    core.warning(
      `Could not read ${source.owner}/${source.repo} metadata: ${
        error instanceof Error ? error.message : String(error)
      }`
    )
  }

  const rawDesc = overrides.desc || fetched.description || name
  const desc = sanitizeDesc(rawDesc, name)

  const homepage =
    overrides.homepage ||
    fetched.homepage ||
    `https://github.com/${source.owner}/${source.repo}`

  const spdx = fetched.license?.spdx_id
  const license =
    overrides.license || (spdx && spdx !== 'NOASSERTION' ? spdx : undefined)

  return { desc, homepage, license }
}
