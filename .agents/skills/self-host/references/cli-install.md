# CLI bootstrap

Skill installation alone does not install the CLI. The current product is the
Go `self-host` binary; the TypeScript CLI below is legacy.

## Go CLI (current)

Locate it: `command -v self-host`. Then run `self-host skill`. If that prints
the agent guide, the Go CLI is installed: read the guide and follow it. After
`self-host self-update`, run `self-host skill` again.

If `self-host` is missing, install it. Linux and macOS (amd64/arm64) are the
targets; use the Linux binary inside WSL, and native Windows is unsupported.

```bash
curl -fsSL https://raw.githubusercontent.com/ajnart/selfhost-skills/main/new-cli/install.sh | bash
export PATH="$HOME/.local/bin:$PATH"
self-host --version
```

The installer picks the highest stable `new-cli-vX.Y.Z` release, verifies it
against `checksums.txt`, and installs into `~/.local/bin` (`/usr/local/bin` as
root). `SELF_HOST_INSTALL_DIR` changes the destination and
`SELF_HOST_VERSION=X.Y.Z` pins a version.

While the repository is private, set `SELF_HOST_GITHUB_TOKEN` through the
user's credential provider; the installer and `self-host self-update` use it for
GitHub API downloads. Never put the token in commands or reports. An
unauthenticated `curl` cannot fetch a private install script: fetch it with an
authenticated client (for example `gh api -H 'Accept:
application/vnd.github.raw+json' repos/ajnart/selfhost-skills/contents/new-cli/install.sh`)
and run `bash install.sh`. If no access is available, stop and ask for it.

`self-host self-update` replaces a release binary with the latest verified
release. A development build cannot self-update.

## Legacy TypeScript CLI

Use this section only when `self-host skill` does not print the agent guide but
`self-host doctor --scope plan --json` succeeds, or when a saved legacy owner
exists. Run that command and `self-host catalog recipes --json` to check the
planning runtime and recipe contract. If the recipe command is absent, update
the CLI before using a bundled app recipe.

For a supplied private native binary, verify its owner-provided SHA-256 before
running it. Use the binary matching Linux, macOS, or Windows and the host's
x64/ARM64 architecture; on Windows the executable is `self-host.exe`. Run
`doctor --scope plan --json` from its absolute path before adding it to `PATH`.
Do not infer Docker apply support from a successful planning check.

If no native artifact is available, private repository access plus Bun 1.4+
and Node.js 20.12+ can produce an independently installed CLI package:

```bash
gh repo clone ajnart/selfhost-skills
cd selfhost-skills
bun install --frozen-lockfile
cli_tgz=$(npm pack ./packages/cli --pack-destination . --silent)
npm install -g "./$cli_tgz"
self-host doctor --scope plan --json
```

Check out the same reviewed revision as the installed skill before packing.
The legacy CLI package remains private; there is no public `npx` install. Do
not silently run the repository TypeScript entry point as if it were the
installed product.
