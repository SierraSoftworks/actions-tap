import * as core from '@actions/core'
import { GitHub } from '@actions/github/lib/utils.js'
import { createAppAuth } from '@octokit/auth-app'
import { createPrivateKey } from 'crypto'

export type Octokit = InstanceType<typeof GitHub>

export interface AppCredentials {
  appId: string
  privateKey: string
}

// NOTE: we construct `GitHub` directly rather than via `getOctokitOptions('',
// …)`. With an empty token that helper rewrites `auth` to the string `"token "`,
// clobbering the `{ appId, privateKey }` object the app auth strategy needs.

/**
 * GitHub issues App private keys in PKCS#1 (`BEGIN RSA PRIVATE KEY`), but
 * `@octokit/auth-app` only accepts PKCS#8. Normalise to PKCS#8 so the raw key
 * from GitHub works without any manual conversion. Already-PKCS#8 keys pass
 * through unchanged.
 */
export function toPkcs8(privateKey: string): string {
  return createPrivateKey(privateKey)
    .export({ type: 'pkcs8', format: 'pem' })
    .toString()
}

/**
 * Authenticate as the GitHub App, discover its installation on the tap
 * repository, and return an Octokit client that mints installation access
 * tokens scoped to just that repository. This keeps the org-level credentials
 * usable from any project's workflow while limiting write access to the tap.
 */
export async function getTapOctokit(
  creds: AppCredentials,
  owner: string,
  repo: string
): Promise<Octokit> {
  const privateKey = toPkcs8(creds.privateKey)

  const appOctokit = new GitHub({
    authStrategy: createAppAuth,
    auth: { appId: creds.appId, privateKey }
  })

  const { data: installation } = await appOctokit.rest.apps.getRepoInstallation(
    { owner, repo }
  )
  core.debug(
    `Resolved app installation ${installation.id} for ${owner}/${repo}`
  )

  return new GitHub({
    authStrategy: createAppAuth,
    auth: {
      appId: creds.appId,
      privateKey,
      installationId: installation.id
    }
  })
}
