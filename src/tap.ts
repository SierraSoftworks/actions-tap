import * as core from '@actions/core'
import type { Octokit } from './auth.js'

export interface TapRepo {
  owner: string
  repo: string
  branch?: string
}

interface ExistingFile {
  content: string
  sha: string
}

const MAX_ATTEMPTS = 5

async function getExistingFile(
  octokit: Octokit,
  tap: TapRepo,
  path: string
): Promise<ExistingFile | null> {
  try {
    const { data } = await octokit.rest.repos.getContent({
      owner: tap.owner,
      repo: tap.repo,
      path,
      ref: tap.branch
    })
    if (Array.isArray(data) || data.type !== 'file') {
      return null
    }
    return {
      content: Buffer.from(data.content, 'base64').toString('utf8'),
      sha: data.sha
    }
  } catch (error) {
    if ((error as { status?: number }).status === 404) {
      return null
    }
    throw error
  }
}

/**
 * Write a formula to the tap using the Contents API, recomputing the contents
 * from the latest state on every attempt. A 409 (or stale-SHA 422) means another
 * matrix job committed concurrently, so we re-read and re-render before
 * retrying — this is what lets per-platform jobs converge without a fan-in step.
 *
 * `render` receives the current file contents (or null) and returns the desired
 * contents; returning the unchanged contents short-circuits the write.
 */
export async function updateFormula(
  octokit: Octokit,
  tap: TapRepo,
  path: string,
  message: string,
  render: (current: string | null) => string
): Promise<'updated' | 'unchanged'> {
  for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt++) {
    const existing = await getExistingFile(octokit, tap, path)
    const content = render(existing?.content ?? null)

    if (existing && existing.content === content) {
      core.info(`Formula ${path} is already up to date.`)
      return 'unchanged'
    }

    try {
      await octokit.rest.repos.createOrUpdateFileContents({
        owner: tap.owner,
        repo: tap.repo,
        path,
        message,
        content: Buffer.from(content, 'utf8').toString('base64'),
        sha: existing?.sha,
        branch: tap.branch
      })
      core.info(`Committed ${path} to ${tap.owner}/${tap.repo}.`)
      return 'updated'
    } catch (error) {
      const status = (error as { status?: number }).status
      if ((status === 409 || status === 422) && attempt < MAX_ATTEMPTS) {
        core.info(
          `Concurrent update detected (attempt ${attempt}/${MAX_ATTEMPTS}); retrying.`
        )
        continue
      }
      throw error
    }
  }

  throw new Error(
    `Failed to update ${path} after ${MAX_ATTEMPTS} attempts due to concurrent writes.`
  )
}
