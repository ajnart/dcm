# CLI install and troubleshooting

Installing the skill does not install the CLI. The current product is the Go
`self-host` binary; the TypeScript CLI below is legacy.

## Prerequisites

- **Deploying:** Docker with the Compose v2 plugin. `self-host doctor` checks
  it and each failure carries a hint.
- **Installing the CLI:** `curl`, `tar`, and Linux or macOS (amd64 or arm64).
  On Windows use WSL.
- **Bun:** only for the Skills CLI and legacy helpers, never for the Go CLI.

## Go CLI (current)

Locate it: `command -v self-host`. Then run `self-host skill`. If that prints
the agent guide, the CLI is installed: read the guide and follow it.

If `self-host` is missing, install it:

```bash
curl -fsSL https://raw.githubusercontent.com/ajnart/selfhost-skills/main/new-cli/install.sh | bash
export PATH="$HOME/.local/bin:$PATH"
self-host --version
```

A failed download prints a `curl` error, but the pipe hides its exit status.
When running it from a script, use `set -o pipefail` or download the script
first and run `bash install.sh`. A 404 or authentication error means GitHub
refused access: see Troubleshooting. Never put a token in a command or report.
If no access is available, stop and ask for it.

The installer picks the highest stable `new-cli-vX.Y.Z` release, verifies it
against `checksums.txt`, and installs into `~/.local/bin` (`/usr/local/bin` as
root). `SELF_HOST_INSTALL_DIR` changes the destination and
`SELF_HOST_VERSION=X.Y.Z` pins a version.

`self-host self-update` replaces a release binary with the latest verified
release, then run `self-host skill` again. A development build cannot
self-update.

## Troubleshooting

| Symptom | Fix |
| --- | --- |
| `self-host: command not found` | Add the install directory to `PATH`, for example `export PATH="$HOME/.local/bin:$PATH"`, or install the CLI. |
| `self-host skill` lacks "Two kinds of users" | The binary predates the New and Advanced guide. Run `self-host self-update` and `self-host skill`. If it reports the same version, follow the printed guide anyway. |
| `self-host skill` is an unknown command | The older TypeScript CLI. Use the legacy section below. |
| Docker missing or `docker-socket` fails in `self-host doctor` | Install Docker with Compose v2, or start Docker Desktop, OrbStack or the daemon, then rerun `self-host doctor`. Do not deploy before it passes. |
| If you get a 404 or authentication error (installer, `self-update` or the Skills CLI) | GitHub refused access. Run `gh auth login`, then install with `gh api -H 'Accept: application/vnd.github.raw+json' repos/ajnart/selfhost-skills/contents/new-cli/install.sh \| SELF_HOST_GITHUB_TOKEN="$(gh auth token)" bash`. `self-update` and the Skills CLI use `gh` or `SELF_HOST_GITHUB_TOKEN`, or an SSH key. |
| Windows | Native Windows is unsupported. Install WSL, then run everything inside it, including the install command. |
| `not on your PATH` warning | The binary installed; export the directory it names. |

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
