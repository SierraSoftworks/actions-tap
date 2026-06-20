import * as core from '@actions/core'
import { GitHub, getOctokitOptions } from '@actions/github/lib/utils.js'
import { createAppAuth } from '@octokit/auth-app'

export type Octokit = InstanceType<typeof GitHub>

export interface AppCredentials {
  appId: string
  privateKey: string
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
  const appOctokit = new GitHub(
    getOctokitOptions('', {
      authStrategy: createAppAuth,
      auth: { appId: creds.appId, privateKey: creds.privateKey }
    })
  )

  const { data: installation } = await appOctokit.rest.apps.getRepoInstallation(
    { owner, repo }
  )
  core.debug(
    `Resolved app installation ${installation.id} for ${owner}/${repo}`
  )

  return new GitHub(
    getOctokitOptions('', {
      authStrategy: createAppAuth,
      auth: {
        appId: creds.appId,
        privateKey: creds.privateKey,
        installationId: installation.id
      }
    })
  )
}
