# Release gate

Version 1 releases preserve Git history and publish one generated Agent Plugins
1.0 archive with a Claude Code compatibility manifest. The source of truth
remains `.agents/skills/`; never commit a second `skills/` tree or a runtime portability
symlink. The repository-only `CLAUDE.md` alias is not part of the skill payload.

## Prepare

1. Update the same semantic version in `package.json`, `packages/cli/package.json`,
   the registry, and both files under `packaging/`. CI derives the archive
   version from the registry and rejects a CLI version that differs.
2. Replace `Unreleased` in the matching changelog heading with an ISO date.
3. Regenerate discovery files with `bun scripts/skillpack.ts index --write`.
4. Review every changed workflow against its owning contract and keep generated,
   secret, session, evidence, and client-install state out of Git.

## Prove

Run only the release gates:

```bash
release_version=$(bun -p 'require("./package.json").version')
bun scripts/skillpack.ts validate --scope all
bun scripts/skillpack.ts audit
bun scripts/skillpack.ts test --all
bun scripts/skillpack.ts benchmark --runs 5
bun scripts/skillpack.ts release-check --tag "v${release_version}"
bun scripts/skillpack.ts package --version "$release_version" --output dist
```

The audit scans `HEAD`, branch, remote-branch, and tag history; CI fetches all
remote branches first. Codex-local checkpoint refs are outside the published
repository history. The audit never reads a sensitive historical path or prints
a matched value.
Review tracked screenshots visually for host details, user data, and credentials
even when their PNG/SVG metadata scan passes.

Extract the ZIP into a disposable directory. Validate root `plugin.json`
against Agent Plugins 1.0, validate the single `skills/self-host/SKILL.md`
against Agent Skills, and run the current Claude plugin validator against the
same directory. Validate the ZIP and `SHA256SUMS`, then remove the disposable
files.

Build the provider catalogs and plugin trees from that exact ZIP, manifest, and
checksum. The URL below identifies the intended GitHub Release asset in both
provenance manifests. Claude installs from its generated Git branch, so the
repository can remain private; local export verifies the URL shape and version
but cannot prove the asset exists until publication:

```bash
bun scripts/distribution.ts \
  --archive "dist/selfhost-skills-${release_version}.zip" \
  --manifest dist/RELEASE-MANIFEST.json \
  --checksums dist/SHA256SUMS \
  --archive-url "https://github.com/ajnart/selfhost-skills/releases/download/v${release_version}/selfhost-skills-${release_version}.zip" \
  --output dist/distribution
```

Each provider root contains an independently verified plugin tree and its own
marketplace. The Claude catalog points to `./plugins/selfhost-skills` inside
its Git branch. Separate roots prevent Codex from also discovering Claude's
legacy-compatible marketplace path. The exporter rejects path escapes, extra
public skills, file/hash/mode mismatches, an unsafe URL, and nonempty output.
The tag job adds the source commit to both provenance manifests; the branch
publisher rejects an older or unrelated source commit and changed archive
bytes under an existing version.
[OpenAI marketplace paths](https://developers.openai.com/plugins/build/plugins)
and [Claude relative plugin sources](https://code.claude.com/docs/en/plugin-marketplaces)
define the two catalogs.

The package contains the full `self-host/workflows/` tree. Internal documents
use `GUIDE.md` and are not independently discovered. Verify the public entry's
size budget, every on-demand link, saved owner/profile ID compatibility, and
standalone runtime helpers in both copy and symlink install layouts.

## Publish

Create the signed or annotated `v<version>` tag only after every gate passes and
push it to the source repository. The tag workflow rechecks the release
contract and publishes the standalone CLI to npm through its trusted publisher.
It builds the ZIP, uploads a short-lived Actions artifact, then creates
a durable GitHub Release with the ZIP, manifest, and checksum. It downloads the
published assets and checks byte equality before exporting and pushing two
generated branches in the same repository:

| Ref | Contents | Client source |
| --- | --- | --- |
| `plugin-claude` | `.claude-plugin/marketplace.json`, `plugins/selfhost-skills/`, and provenance | `/plugin marketplace add ajnart/selfhost-skills@plugin-claude` |
| `plugin-codex` | `.agents/plugins/marketplace.json`, `plugins/selfhost-skills/`, and provenance | `codex plugin marketplace add ajnart/selfhost-skills --ref plugin-codex` |

The source `main` branch remains the only editable skill tree. The generated
branches preserve prior commits for rollback. The tag job needs repository
`contents: write`; branch protection must permit its GitHub Actions token to
push these two branches. An existing release is accepted only when all three
downloaded assets exactly match the newly built files. A failed branch push
leaves the previous branch version installed; repair that push rather than
changing published assets for the same tag. [GitHub release creation](https://cli.github.com/manual/gh_release_create),
[release download](https://cli.github.com/manual/gh_release_download),
[Codex marketplace Git refs](https://developers.openai.com/plugins/build/plugins),
[Claude marketplace Git refs](https://code.claude.com/docs/en/plugin-marketplaces).

### First npm publish and ongoing CLI releases

`@ajnart/selfhost` is a **public** npm package even though this Git repository
is private. Review the exact `npm pack` file list before the first publish:
the CLI tarball contains its bundled JavaScript, catalog, media runtime,
README, and license, but not the Agent Skill or private project state. npm
cannot add a trusted publisher to a package that does not yet exist. The
package owner must make one authenticated, reviewed first publish of the
current `packages/cli` version (`npm publish --access public --provenance=false`)
with npm account 2FA **from the exact release commit, before pushing its tag**.
Do not use a broad repository token or put npm credentials in this repository.
The tag job packs the CLI and checks its SHA-512 integrity against that first
publication; it skips the duplicate publish only when the bytes match. If the
package is still missing, or the same version has different bytes, the tag job
fails before publishing the skill archive. Once the package exists, set its npm
trusted publisher to GitHub user `ajnart`, repository `selfhost-skills`, workflow `validate.yml`,
with direct `npm publish` allowed; no environment name is configured in CI.

Subsequent `v<version>` tags publish the matching CLI package through GitHub
Actions OIDC after static, behavior, package, and release-contract gates.
The job checks npm 11.5.1+, Node 24, the exact tag/version match, and the
published registry executable. The skill release waits for it. Private GitHub
repositories cannot receive npm provenance attestations, so this package
explicitly disables provenance instead of promising it. Never reuse a version
already published to npm; bump all version sources for the next tag.
[npm trusted publishing](https://docs.npmjs.com/trusted-publishers/),
[scoped public packages](https://docs.npmjs.com/creating-and-publishing-scoped-public-packages/).

After both branches are live, install each in a fresh client and record the
skill invocation and one bundled guide/helper lookup from the cached install.
The tag workflow proves package and catalog structure; client installation is
a separate acceptance gate. Pi installs the source tag as
`pi install git:github.com/ajnart/selfhost-skills@v<version>`; OpenCode installs
the canonical skill through Skills CLI or `.agents/skills`. Public OpenAI or
Anthropic directory submission is separate from these working Git routes and
needs external review. [Pi packages](https://github.com/earendil-works/pi/blob/main/packages/coding-agent/docs/packages.md),
[OpenCode skills](https://opencode.ai/docs/skills/),
[OpenAI submission](https://developers.openai.com/plugins/deploy/submission),
[Claude distribution](https://code.claude.com/docs/en/plugins).
