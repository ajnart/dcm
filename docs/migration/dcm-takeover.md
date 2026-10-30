# Runbook: ajnart/dcm becomes ajnart/self-host

Goal: the merged history (self-host + dcm, branch `dev-dcm-merge`) lives in the repository that ends up named `ajnart/self-host`.
The old self-host repo is parked as `ajnart/self-host-old` and **archived** (public, read-only). Making it private is an explicit opt-in (`archive --private`) and has costs, see Step 7.

Every script in `scripts/migrate/` is a dry run until you add `--yes`. Run each one dry first and read it.
Nothing here pushes or renames on its own; you run it.

## Facts checked on 2026-10-30 (read-only)

|                                                      | `ajnart/self-host` (old)                                            | `ajnart/dcm` (becomes self-host)                |
| ---------------------------------------------------- | ------------------------------------------------------------------- | ----------------------------------------------- |
| repo id                                              | 1349952104                                                          | 950728976                                       |
| stars / forks                                        | 5 / 0                                                               | 1448 / 59                                       |
| open issues                                          | 0 (last number #590; commits cite up to #615)                       | 0 (highest number #112; 2 open PRs: #104, #110) |
| closed issues / PRs                                  | 315 / 299 (all stay in `self-host-old`)                             | not counted                                     |
| merge settings                                       | squash only, delete branch on merge                                 | merge, squash, rebase                           |
| ruleset                                              | `protect main` (id 25234720): no deletion, no force push, no bypass | none                                            |
| Actions policy                                       | selected: GitHub-owned + `goreleaser/goreleaser-action@*`           | all                                             |
| license                                              | Apache-2.0                                                          | AGPL-3.0                                        |
| releases                                             | 39 (`vX.Y.Z` and `new-cli-vX.Y.Z` twins, 2.2 GB of assets)          | `v1` "v1: Initial release" (Latest, no assets)  |
| tags                                                 | 39 CLI tags                                                         | `v1` -> `a42eb18b`                              |
| Actions secrets and variables, deploy keys, webhooks | none                                                                | none                                            |
| environments                                         | none                                                                | `copilot` (the Copilot coding agent)            |

- `ajnart/dcm` `main` (`e499c2fd`) is an ancestor of the merged branch, so the push is a **fast-forward**. No force push is needed, and the script refuses one without `--force`.
- Both repos use only the automatic `GITHUB_TOKEN` in workflows. **No secret has to be recreated.**
- Everything else authenticates from your machine: the GHCR push uses your `docker login`, `publish-aur.sh` your AUR SSH key, `publish-homebrew.sh` and `publish-site.sh` your `gh` and `wrangler` logins. `POSTHOG_PROJECT_KEY` stays unset (see `docs/releasing.md`).
- Cloudflare Pages: `self-host-fyi` is Git-connected to repo id 1349952104 (old repo), production branch `main`, build `bash scripts/build-site-pages.sh`, output `site/dist-pages`, domains `self-host.fyi` and `self-host-fyi.pages.dev`. `dcm` is direct-upload (no Git source), domains `compose.ajnart.dev`, `compose.homarr.dev`, `docker-compose-maker.pages.dev`.
- GHCR: package `ghcr.io/ajnart/self-host` is not linked to any repository; `ghcr.io/ajnart/dcm` is linked to `ajnart/dcm` and follows the repo through the rename.
- GitHub's tag-push rule: no workflow events are created when more than three tags are pushed at once, so the single 39-tag push (the second of the script's two pushes) does not start `release.yml` or `e2e.yml`. The first push (`main`) does start `ci` and `dcm-image`.

## Decide first

1. **License.** The old repo is Apache-2.0, dcm is AGPL-3.0 (`dcm/LICENSE`). Check which `LICENSE` sits at the repo root; GitHub displays that one.
2. **`#NNN` references.** Old self-host commit messages cite `#113`-`#615`. In the new repo they link to dcm's issues/PRs (numbers up to #112 resolve to the wrong thing, the rest to nothing), and new issues continue from #113, colliding with old numbers. GitHub cannot change this. Old numbers resolve only in `ajnart/self-host-old`, which stays public once archived.
3. **Cloudflare Pages strategy** (see Step 9).
4. **Old repo: archive or private.** Default is archive: it stays public and read-only, so its 5 stars, 315 closed issues, 299 PRs and public release assets stay readable. Private (`archive --private`) erases stars and watchers, hides issues and PRs, and stops anonymous downloads of its release assets; only use it if you want the old repo hidden.
5. **Open dcm PRs.** They target dcm's old tree: #104 ("target auto-container PRs at dev", edits the old `auto-add-container.yml` that no longer exists after the move) is obsolete, close it. #110 (README: second one-click template, the RepoCloud button) is a product decision: reapply it to the new README or close it.

## 0. Preflight

```bash
export GOFLAGS=-buildvcs=false
git fetch origin && git status --short            # clean
gofmt -l .                                        # prints nothing
go build ./... && go vet ./... && go vet -tags e2e ./e2e/
go test ./...
go test -race ./internal/tui/ ./internal/activity/
bash -n install.sh
git merge-base --is-ancestor "$(git ls-remote origin refs/heads/main | cut -f1)" HEAD && echo "old main is in HEAD"
gh auth status                                    # token needs repo scope; you must be admin on both repos
```

Also run the dcm and site builds (`bun install && bun run build`, or whatever the turbo pipeline is on this branch). Finish all work on the branch first: the push publishes `HEAD`.
Check that `go.mod` still says `module github.com/ajnart/self-host`.

## 1. Push the merged history to ajnart/dcm

```bash
scripts/migrate/push-merged-history.sh            # read it
scripts/migrate/push-merged-history.sh --yes
```

It checks a clean tree and the branch, shows all three root commits (`init` 2025-03-17 is dcm's, `startup` and the scaffold are self-host's), confirms old main and dcm main are ancestors of `HEAD`, confirms every CLI tag is an ancestor and equals the tag on the old repo, then makes **two pushes**: `HEAD:main` first, then all 39 tags together in one push. dcm's `v1` is left alone and the script stops if a tag name clashes with a different commit.

What the pushes start:

- Push 1 (`main`) starts `ci` and also `dcm-image` (`.github/workflows/dcm-image.yml` runs on pushes to `main` that touch `dcm/**`), which publishes `ghcr.io/ajnart/dcm:latest` early. This is expected and harmless: same image name, same content the next dcm change would publish. To stop it anyway: `gh run list --repo ajnart/dcm --workflow dcm-image.yml`, then `gh run cancel RUN_ID`.
- Push 2 (tags) starts nothing: more than three tags in one push create no workflow events, so `release.yml` and `e2e.yml` do not run. If one did start, cancel it: the release assets are published by hand.

Check afterwards: `gh run list --repo ajnart/dcm` shows `ci` and `dcm-image` for the main push and nothing else.

## 2. Backport releases to ajnart/dcm (before the rename)

Releases must exist on the repo that is named `ajnart/self-host` at the moment the name moves, or `install.sh` and `self-host self-update` (which read that repo's releases) fail in between. So copy them first, from the old repo into dcm:

```bash
scripts/migrate/backport-releases.sh --old ajnart/self-host --new ajnart/dcm
scripts/migrate/backport-releases.sh --old ajnart/self-host --new ajnart/dcm --yes
```

Oldest first, `--latest=false` for each, then Latest is set explicitly on the release that is Latest on the old repo (`v1.0.1`). It downloads 2.2 GB, one release at a time, and compares asset names and sizes after each upload. Rerun after any failure: a release that already exists is not skipped blindly, its asset names and sizes are compared with the old repo and missing or different assets are uploaded with `--clobber` (notes, title and flags of an existing release are left alone). A half-created release (create failed after it started) must be deleted with `gh release delete TAG --repo ajnart/dcm` first.

Release dates become the dates of this run; the order stays. Asset URLs and release-note links to `github.com/ajnart/self-host/releases/download/...` start working when the rename lands. Check:

```bash
gh release list --repo ajnart/dcm --limit 100 | wc -l        # 40: 39 + v1
gh release view v1.0.1 --repo ajnart/dcm --json isLatest,assets --jq '[.isLatest, (.assets|length)]'
```

The script's summary must read `failed 0`. For an independent parity check of all assets (names and sizes), the output of these two must be identical:

```bash
for r in ajnart/self-host ajnart/dcm; do
  for t in $(gh release list --repo "$r" --limit 100 --json tagName --jq '.[].tagName' | sort); do
    gh release view "$t" --repo "$r" --json assets --jq ".assets[] | \"$t \(.name) \(.size)\""
  done | grep -v '^v1 ' | sort > "/tmp/assets-${r#*/}.txt"
done
diff /tmp/assets-self-host.txt /tmp/assets-dcm.txt && echo "assets match"
```

## 3. Rename

Preconditions the script enforces: dcm `main` contains old `main`, every old tag exists on dcm with the same object, every old release exists on dcm with the same asset names and sizes.

```bash
scripts/migrate/rename-repos.sh rename
scripts/migrate/rename-repos.sh rename --yes
```

Order matters:

1. `ajnart/self-host` -> `ajnart/self-host-old` (frees the name; GitHub redirects the old name to the parked repo).
2. `ajnart/dcm` -> `ajnart/self-host` (takes the name; the redirect from the old name is dropped, and `ajnart/dcm` now redirects to `ajnart/self-host`).

Never create a repo called `self-host` in between: that breaks the dcm redirect. If step 2 fails with 422, wait a minute and rerun; the script resumes at the second rename.

Verify at once:

```bash
gh api repos/ajnart/self-host --jq '[.id,.name,.default_branch]'    # [950728976,"self-host","main"]
gh api repos/ajnart/dcm --jq .full_name                              # ajnart/self-host (redirect)
curl -fsSL https://raw.githubusercontent.com/ajnart/self-host/main/install.sh | head -3
SELF_HOST_GITHUB_TOKEN="$(gh auth token)" VERIFY_INSTALL_URL="file://$PWD/install.sh" scripts/verify-install.sh
```

Your local `origin` (`git@github.com:ajnart/self-host.git`) now points at the new repo. Every other clone of either old repo fast-forwards on `git pull`, because both histories are inside the new `main`.

## 4. Configure the new repo

Snapshot dcm's settings first; the rollback below needs them:

```bash
gh api repos/ajnart/self-host > /tmp/before-configure.json
gh api repos/ajnart/self-host/actions/permissions > /tmp/before-actions.json
```

```bash
scripts/migrate/rename-repos.sh configure
scripts/migrate/rename-repos.sh configure --yes
```

Copies from `self-host-old`: description, homepage, topics (20), squash-only merge settings and commit title/message, delete-branch-on-merge, missing labels (`needs-triage`, `ready-for-agent`, `ready-for-human`, `needs-info`, `accessibility`, `dependencies`, `github_actions`), the Actions policy, Dependabot security updates, and the `protect main` ruleset.

Actions policy: the old repo only allows GitHub-owned actions plus `goreleaser/goreleaser-action@*`, which would block the new workflows. The script keeps `selected` and adds every non-GitHub action found in `.github/workflows/*.yml` of this checkout as `owner/repo@*` (today: `docker/build-push-action`, `docker/login-action`, `docker/metadata-action`, `docker/setup-buildx-action`, `docker/setup-qemu-action`, `goreleaser/goreleaser-action`, `oven-sh/setup-bun`, `peter-evans/create-pull-request`), and prints the list in the dry run. Add a pattern by hand whenever a workflow starts using a new third-party action. It also turns on **"Allow GitHub Actions to create and approve pull requests"** (`can_approve_pull_request_reviews: true`; default token permissions stay read-only), which `peter-evans/create-pull-request` with `GITHUB_TOKEN` in `dcm-add-container.yml` needs. The ruleset goes last because it blocks force pushes with no bypass; to force-push `main` later, disable it first, as was done on 2026-10-27.

Left as dcm has them: wiki and discussions (both on), labels `accepted` and `container`, the `copilot` environment, the two open dcm PRs (see "Decide first" item 5).

## 5. Rerun the release backport as a check

```bash
scripts/migrate/backport-releases.sh --yes          # defaults: --old ajnart/self-host-old --new ajnart/self-host
```

Everything should print `skip ... assets match`, and the summary `created 0, assets synced 0, ... failed 0`. It also catches any release, or any asset, published on the old repo between steps 2 and 3.

## 6. Move open issues (optional)

```bash
scripts/migrate/transfer-issues.sh            # read it
scripts/migrate/transfer-issues.sh --yes
```

The old repo has no open issues today, so this is a no-op. GitHub rules: same owner, only **open** issues move (closed issues and PRs never do; they stay in `self-host-old`), comments and assignees stay, labels stay if the name exists on the target, and an issue of a private repo cannot go to a public repo. Run it before Step 7: an archived repo is read-only, so its open issues could no longer be handled there.

## 7. Archive the old repo

```bash
scripts/migrate/rename-repos.sh archive           # read it
scripts/migrate/rename-repos.sh archive --yes
```

Sets `archived: true` on `ajnart/self-host-old`: it stays public and becomes read-only, so its 5 stars, 315 closed issues, 299 PRs, commit history and public release assets stay readable (old `#NNN` references keep resolving there). It refuses while releases or their assets are missing on the new repo, or open issues remain.

Opt-in alternative, **not** the default: `rename-repos.sh archive --private --yes` makes it private instead. GitHub then erases its stars and watchers and detaches public forks (none), issues and PRs are no longer visible to anyone else, and anonymous downloads of its release assets stop working. Private is the only way to hide the old repo; archive does not hide anything.

## 8. Package channels

Nothing to change: the final name is `ajnart/self-host`.

- `install.sh` (`DEFAULT_REPO="ajnart/self-host"`), `self-update`, `.goreleaser.yaml` download URLs, `scripts/publish-*.sh` (`-R ajnart/self-host`) and the Homebrew cask and AUR PKGBUILD URLs all resolve against the new repo, which now holds the same assets byte for byte (checksums are unchanged).
- The next release goes as `docs/releasing.md` says: local goreleaser, `gh release create --draft --target "$(git rev-parse HEAD)"`, then `scripts/publish-channels.sh X.Y.Z`. Rerun the full e2e first.
- GHCR: `ghcr.io/ajnart/self-host` pushes with your `docker login`; check with `docker buildx imagetools inspect ghcr.io/ajnart/self-host:latest`. `ghcr.io/ajnart/dcm` stays linked to the renamed repo (Package settings -> check "Source repository").
- Go proxy: `go install github.com/ajnart/self-host/cmd/self-host@v1.0.1` keeps working. Tags and commit SHAs are unchanged, so `proxy.golang.org` and `sum.golang.org` entries stay valid. **Never re-tag a version.** dcm's `v1` is not a semver tag and Go ignores it. Verify: `cd "$(mktemp -d)" && go mod init scratch && go list -m -versions github.com/ajnart/self-host`.
- Telemetry (ADR 0006), the release workflow, and site data (`site/src/data/catalog.json` star counts) need no change.

## 9. Cloudflare Pages

- **`self-host-fyi`** is tied to the old repo by id: it keeps building `self-host-old`, which gets no more pushes. Cloudflare cannot re-point a Pages project to another repo, and a direct-upload project cannot switch to Git later. Choose one:
  - _Keep it, deploy by hand._ `scripts/publish-site.sh X.Y.Z` already runs `wrangler pages deploy site/dist-pages --project-name self-host-fyi`. Installer and site changes then need that command after each merge; the "merging install.sh deploys immediately" behaviour is lost.
  - _Recreate it from the dashboard_ (Workers & Pages -> Create -> Pages -> Connect to Git, not `wrangler pages project create`): repo `ajnart/self-host`, production branch `main`, build command `bash scripts/build-site-pages.sh`, output `site/dist-pages`, root empty, same watch paths. Verify on its `*.pages.dev` address, then remove `self-host.fyi` from the old project and add it to the new one (brief gap), then delete the old project. The new project needs a different name or the old one deleted first.
  - Until one of these is done, merging to `main` does not update self-host.fyi. Rehearse on a preview first.
- **`dcm`** has no Git source: nothing breaks. Keep deploying with `bun run deploy` in `dcm/` (or its replacement) until you wire a new project.
- **Redirect `compose.ajnart.dev` -> `https://self-host.fyi/compose`:** once the new page exists, add a Cloudflare Single Redirect rule on the `ajnart.dev` zone (301, preserve path as you like), and the same for `compose.homarr.dev` if you want it. Then remove both domains from the `dcm` Pages project. Until then both domains keep serving the old Next.js build.
- GitHub Apps: Cloudflare Workers and Pages is installed per account, so no reinstall is needed. Check `https://github.com/settings/installations` that it can see `ajnart/self-host` (repository access "all" or the repo listed).

## 10. After the dust settles

- `git remote -v` in every checkout and worktree: `origin` is correct already; fix anything that used the `ajnart/dcm` URL (works through the redirect, but update it).
- Update docs that name the old repo's issue tracker or numbers (`docs/agents/*`) if you change their meaning.
- `gh repo view ajnart/self-host-old --json isArchived,isPrivate` (`true,false` after the default Step 7). Do not delete it for a while.
- Watch `gh run list --repo ajnart/self-host` for the first `ci` and the nightly `e2e` (03:17 UTC).

## Rollback

| Reached                        | Undo                                                                                                                                                                                                                                                                                                                                                     |
| ------------------------------ | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| After Step 1 (push)            | Additive. Delete the tags (`git push git@github.com:ajnart/dcm.git --delete TAG ...`) and, if wanted, restore dcm main: `git push --force-with-lease=refs/heads/main:<pushed sha> git@github.com:ajnart/dcm.git e499c2fd347e39803fd062dcba6499891e9a4a2e:refs/heads/main`. Go proxy keeps any version it already fetched; the SHAs were the same anyway. |
| After Step 2 (releases on dcm) | `gh release delete TAG --repo ajnart/dcm --yes` per release (the tag stays without `--cleanup-tag`). Keep dcm's `v1` release.                                                                                                                                       |
| After Step 3 (renamed)         | If Step 7 ran, unarchive `self-host-old` first. Reverse order: `gh api -X PATCH repos/ajnart/self-host -f name=dcm`, then `gh api -X PATCH repos/ajnart/self-host-old -f name=self-host`. Redirects return as long as no repo took either name.                                                                                                                                                          |
| After Step 4 (configure)       | Settings: `gh api -X PATCH repos/ajnart/self-host -F allow_merge_commit=true -F allow_rebase_merge=true` and the description, homepage and topics from `/tmp/before-configure.json`. Actions: `gh api -X PUT repos/ajnart/self-host/actions/permissions -F enabled=true -f allowed_actions=all` (dcm's original, see `/tmp/before-actions.json`), and `gh api -X PUT repos/ajnart/self-host/actions/permissions/workflow -f default_workflow_permissions=read -F can_approve_pull_request_reviews=false`. Ruleset: `gh api repos/ajnart/self-host/rulesets --jq '.[] \| [.id,.name]'`, then `gh api -X DELETE repos/ajnart/self-host/rulesets/ID`. Labels added by the script: `gh label delete NAME --repo ajnart/self-host --yes`. Dependabot security updates: `gh api -X DELETE repos/ajnart/self-host/automated-security-fixes`. |
| After Step 6 (issue transfers) | Not reversible by these scripts. A transferred issue keeps a redirect from its old URL, and `gh issue transfer N ajnart/self-host-old` moves it back by hand but gives it a new number again. Treat transfers as one-way. |
| After Step 7 (archived)        | `gh api -X PATCH repos/ajnart/self-host-old -F archived=false` (GitHub REST "Update a repository": `archived` false unarchives). An archived repo cannot be renamed, so unarchive before undoing Step 3. Nothing is lost by archiving. |
| After Step 7 (`--private`)     | `gh api -X PATCH repos/ajnart/self-host-old -F private=false` (stars and watchers are gone; forks stay detached). Only if it was also archived: unarchive first. |                                                                                                                                                                                                                                        |

Do not force-push `main` of the live repo to undo a bad merge after the first release from it: tags and the Go proxy pin their commits. Revert with a new commit.
