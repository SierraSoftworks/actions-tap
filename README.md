# actions-tap

A GitHub Action that publishes (and incrementally updates) a
[Homebrew](https://brew.sh) formula in the
[Sierra Softworks tap](https://github.com/SierraSoftworks/homebrew-tap) from a
project's GitHub release artifacts.

It is designed to be dropped into a project's release workflow so that cutting a
release automatically keeps the tap up to date — no manual formula edits, and no
fan-in/coordination step.

## How it works

Every Sierra Softworks project publishes release binaries following the
convention `{app}-{os}-{arch}` (`os` ∈ `darwin`/`linux`, `arch` ∈
`amd64`/`arm64`). For each platform this action:

1. Authenticates to the tap using an organisation-level **GitHub App** (it mints
   an installation token scoped to just the tap repository).
2. Downloads the release binary and computes its `sha256`.
3. Merges that platform into the formula (reusing the source repository's
   description, homepage, and license unless overridden) and commits it via the
   GitHub Contents API.

By default the action runs **once, after all artifacts are uploaded**: it scans
every supported platform, downloads whatever is published, and writes the
complete formula in a single commit, so the tap never holds a partially-built
formula. Because this scan is authoritative, platforms whose assets aren't
published (a build that doesn't ship that target, or an asset later removed) are
left out of the formula — and pruned from it if a previous run added them. (An
incremental per-platform mode is also available — see below.)

## Usage

Add a single job that runs after your build matrix completes:

```yaml
jobs:
  # …your existing build matrix that uploads {app}-{os}-{arch} assets…

  tap:
    name: Update Homebrew Tap
    runs-on: ubuntu-latest
    needs: [build]
    steps:
      - uses: SierraSoftworks/actions-tap@v1
        with:
          app-id: ${{ secrets.TAP_APP_ID }}
          private-key: ${{ secrets.TAP_APP_PRIVATE_KEY }}
          github-token: ${{ secrets.GITHUB_TOKEN }}
          aliases: major minor
```

`github-token` is recommended — it authenticates the read of the source
repository's description/homepage/license, avoiding the unauthenticated GitHub
API rate limit (HTTP 403) on shared runners.

`aliases` is optional; `major minor` additionally publishes keg-only versioned
formulae (e.g. `name@3` and `name@3.11`) so users can pin a series.

### Versioned aliases

For a `3.11.4` release with `aliases: major minor`, the action writes:

- `Formula/name.rb` — the latest release (`brew install …/name`)
- `Formula/name@3.rb` — latest within the `3.x` series, keg-only
- `Formula/name@3.11.rb` — latest within the `3.11.x` series, keg-only

Aliases are `keg_only :versioned_formula` so they install alongside the
unversioned formula without link conflicts.

### Incremental per-platform mode

Passing `os`/`arch` (e.g. `${{ matrix.os }}`/`${{ matrix.arch }}`) updates only
that platform's block, guarded by a `# tap:{os}-{arch}` marker, with an
optimistic-concurrency retry so concurrent matrix jobs converge. This trades the
single-commit guarantee for earlier updates; the fan-in job above is preferred.
`windows` is always skipped.

### Inputs

| Input          | Required | Default                        | Description                                     |
| -------------- | -------- | ------------------------------ | ----------------------------------------------- |
| `app-id`       | yes      |                                | GitHub App ID (usually an org secret).          |
| `private-key`  | yes      |                                | GitHub App private key (usually an org secret). |
| `tap`          | no       | `SierraSoftworks/homebrew-tap` | `owner/repo` of the tap.                        |
| `tap-branch`   | no       | default branch                 | Branch to commit to.                            |
| `name`         | no       | source repo name               | Formula name and asset prefix.                  |
| `binary`       | no       | `name`                         | Installed binary name.                          |
| `repository`   | no       | current repo                   | `owner/repo` the release lives in.              |
| `tag`          | no       | release/ref tag                | Release tag; version is the tag minus `v`.      |
| `os` / `arch`  | no       | all platforms                  | Restrict to a single platform (incremental).    |
| `aliases`      | no       |                                | `major`/`minor` versioned aliases to publish.   |
| `desc`         | no       | repo description               | Formula description.                            |
| `homepage`     | no       | repo homepage                  | Formula homepage.                               |
| `license`      | no       | repo license                   | SPDX license id.                                |
| `formula-dir`  | no       | `Formula`                      | Directory within the tap.                       |
| `github-token` | no       | `$GITHUB_TOKEN`                | Token for authenticated metadata reads.         |

### Outputs

| Output      | Description                           |
| ----------- | ------------------------------------- |
| `formula`   | Path to the formula within the tap.   |
| `version`   | The published version.                |
| `platforms` | The platform blocks updated this run. |
| `result`    | `updated` or `unchanged`.             |

## Authentication

This action expects an organisation-level GitHub App with **Contents: Read &
write** on the tap repository (and **Metadata: Read**), installed and scoped to
just the tap. Store its App ID and private key as org-level Actions secrets
(e.g. `TAP_APP_ID`, `TAP_APP_PRIVATE_KEY`) so every project can publish.

## Developing

```bash
npm install
npm run all      # format, lint, test, bundle
```

### Releasing

`dist/` is **not** committed to `main` — it is gitignored. Publishing a GitHub
release triggers [`release.yml`](.github/workflows/release.yml), which builds
the bundle, commits it, and moves the version tag and the floating major tag
(`v1`) onto that commit. Consumers should pin `@v1`.

## License

[MIT](./LICENSE)
