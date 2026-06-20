import * as core from '@actions/core'
import { context } from '@actions/github'

/**
 * Resolve the release tag for this run, preferring an explicit `tag` input and
 * falling back to the triggering release event or a pushed tag ref.
 */
export function getReleaseTag(): string {
  const tag = core.getInput('tag') || getReleaseEventTag() || getRefTag()

  if (!tag) {
    throw new Error(
      'Could not determine the release tag; pass it explicitly via the `tag` input.'
    )
  }

  return tag
}

function getReleaseEventTag(): string | undefined {
  if (context.eventName === 'release') {
    return context.payload.release?.tag_name
  }
  return undefined
}

function getRefTag(): string | undefined {
  if (context.ref.startsWith('refs/tags/')) {
    return context.ref.substring('refs/tags/'.length)
  }
  return undefined
}

/** Strip a leading `v` from a tag to produce a Homebrew `version` value. */
export function versionFromTag(tag: string): string {
  return tag.replace(/^v/, '')
}
