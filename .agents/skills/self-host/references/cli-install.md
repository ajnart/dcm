# Private CLI bootstrap

Locate `self-host` on `PATH` (`command -v self-host` on Linux/macOS;
`Get-Command self-host` in PowerShell). Run `self-host doctor --scope plan --json`
and `self-host catalog recipes --json` to check the installed CLI's planning
runtime and recipe contract. If the recipe command is absent, update the CLI
before using a bundled app recipe. Skill installation alone does not install
the CLI.

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
The CLI package remains private; there is no public `npx` install. If neither
an artifact nor private repository access is available, stop before setup and
ask for one of those inputs. Do not silently run the repository TypeScript
entry point as if it were the installed product.
