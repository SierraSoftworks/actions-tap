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
 * The read is authenticated when a token is supplied (recommended — the
 * unauthenticated API is rate-limited per runner IP and frequently returns 403).
 */
export async function resolveMetadata(
  source: SourceRepo,
  name: string,
  overrides: { desc?: string; homepage?: string; license?: string },
  token?: string
): Promise<ResolvedMetadata> {
  let fetched: RepoApiResponse = {}
  try {
    const headers: Record<string, string> = {
      Accept: 'application/vnd.github+json'
    }
    if (token) {
      headers.Authorization = `Bearer ${token}`
    }
    const response = await fetch(
      `https://api.github.com/repos/${source.owner}/${source.repo}`,
      { headers }
    )
    if (response.ok) {
      fetched = (await response.json()) as RepoApiResponse
    } else {
      core.warning(
        `Could not read ${source.owner}/${source.repo} metadata (${response.status})${
          token ? '' : '; pass `github-token` to authenticate'
        }.`
      )
    }
  } catch (error) {
    core.warning(
      `Could not read ${source.owner}/${source.repo} metadata: ${
        error instanceof Error ? error.message : String(error)
      }`
    )
  }

  const desc = sanitizeDesc(overrides.desc || fetched.description || '', name)
  if (!desc) {
    throw new Error(
      `No usable description for ${name}. Pass \`github-token\` so the source ` +
        'repository description can be read, or set the `desc` input explicitly.'
    )
  }

  const homepage =
    overrides.homepage ||
    fetched.homepage ||
    `https://github.com/${source.owner}/${source.repo}`

  const spdx = fetched.license?.spdx_id
  const license =
    overrides.license || (spdx && spdx !== 'NOASSERTION' ? spdx : undefined)

  return { desc, homepage, license }
}
