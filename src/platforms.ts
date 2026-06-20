/**
 * Platform definitions shared across the action.
 *
 * Every Sierra Softworks project publishes release binaries named
 * `{app}-{os}-{arch}{ext}` where `os` is a GOOS-style value, `arch` is a
 * GOARCH-style value, and `ext` is `.exe` on Windows only. Homebrew only cares
 * about the macOS and Linux binaries, so those are the platforms we model here.
 */

export type Os = 'darwin' | 'linux'
export type Arch = 'amd64' | 'arm64'

export interface Platform {
  os: Os
  arch: Arch
}

/** The full set of platforms a formula can describe, in render order. */
export const ALL_PLATFORMS: readonly Platform[] = [
  { os: 'darwin', arch: 'arm64' },
  { os: 'darwin', arch: 'amd64' },
  { os: 'linux', arch: 'arm64' },
  { os: 'linux', arch: 'amd64' }
]

/** The stable key (and marker suffix) used to identify a platform. */
export function platformKey(platform: Platform): string {
  return `${platform.os}-${platform.arch}`
}

/** Parse a `{os}-{arch}` key back into a Platform, or null if unrecognised. */
export function parsePlatformKey(key: string): Platform | null {
  return ALL_PLATFORMS.find((platform) => platformKey(platform) === key) ?? null
}

/**
 * The name of the release asset for a given app/platform, following the
 * universal `{app}-{os}-{arch}` convention.
 */
export function assetName(app: string, platform: Platform): string {
  return `${app}-${platform.os}-${platform.arch}`
}
