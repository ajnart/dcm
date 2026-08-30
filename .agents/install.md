# Installation contract

## Canonical global copy install

Install the complete pack once for Codex and Claude Code:

```bash
npx skills@latest add ajnart/selfhost-skills --skill '*' --agent codex --agent claude-code --global --copy --yes
```

Run it from any directory with Node.js 22.20.0 or newer active; Node.js 24 is
recommended. The repository is private, so authenticate Git first with an
existing credential helper, `gh auth login`, or SSH. Keep tokens out of the
command, URL, prompt, shell history, and repository files.

This command is the canonical distribution path:

- `--skill '*'` selects all packaged skills;
- the two `--agent` flags target Codex and Claude Code;
- `--global` makes them available outside the current project;
- `--copy` installs complete directories in each client instead of linking
  clients to the installer's canonical copy; and
- `--yes` makes the resolved install non-interactive.

After it finishes, runtime use needs no clone, checkout, or path back to this
repository. Default link mode is also source-repository-independent because
the installer first creates a canonical copy. Each installed skill must
therefore contain every required `SKILL.md`, `agents/`, `scripts/`,
`references/`, and `assets/` file.

## Project-local alternative

Omit `--global` to scope the pack to the current project:

```bash
npx skills@latest add ajnart/selfhost-skills --skill '*' --agent codex --agent claude-code --yes
```

Run that form from the project that should own the installation. Add `--copy`
when each client should receive a direct copy instead of linking to the
project's canonical skill copy.

## Selective installation

Replace `'*'` with one or more named `--skill` selections and retain only the
intended `--agent` targets. For example:

```bash
npx skills@latest add ajnart/selfhost-skills --skill selfhost \
  --agent codex --agent claude-code --global --copy --yes
```

The full pack is the simplest route. Selective installs must include every
required sibling named by the selected stack; `selfhost` is the core dependency
for catalog-backed capabilities.

Use `--list` to inspect discovery without installing. The CLI's `--all` flag is intentionally broader:
it selects every skill for every supported agent target, so use it only when
that fan-out is desired.

## Runtime and release boundary

The installer discovers `.agents/skills/<name>/SKILL.md` and installs each
whole skill directory. Runtime behavior must not depend on arbitrary files at
the source repository root. Both default link mode and explicit copy mode are
release gates; packaging checks belong in disposable projects.

Browser-backed media verification additionally requires `agent-browser` under
an active Node.js 22.20.0+ toolchain. The media password helper never installs
or downloads it: direct execution is attempted first, and only a direct
`ENOENT` retries the fixed `mise exec node@24 -- agent-browser` path. A launched
nonzero browser action is never retried.
