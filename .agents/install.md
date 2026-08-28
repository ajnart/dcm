# Installation contract

Install the complete pack into Codex and Claude Code with the primary
distribution path:

```bash
npx skills@latest add ajnart/selfhost-skills --skill '*' --agent codex --agent claude-code --yes
```

The CLI's `--all` flag is intentionally broader: it selects every skill for
every supported agent target. Use it only when that fan-out is desired.

Run the installer with Node.js 22.20.0 or newer active; Node.js 24 is
recommended. Browser-backed media verification additionally requires
agent-browser to be installed under an active Node.js 22.20.0+ toolchain. The
media password helper never installs or downloads it: direct execution is
attempted first, and only a direct `ENOENT` retries the fixed
`mise exec node@24 -- agent-browser` path. A launched nonzero browser action is
never retried.

The repository is private. `skills` uses existing Git credentials, GitHub CLI
authentication, or SSH; tokens do not belong in the command. A smaller
non-interactive install can replace `'*'` with one or more named `--skill`
selections while retaining only the intended `--agent` targets. For example:

```bash
npx skills@latest add ajnart/selfhost-skills --skill selfhost \
  --agent codex --agent claude-code --yes
```

The current CLI discovers `.agents/skills/<name>/SKILL.md`, copies each whole
skill directory to a canonical install location, then links or copies it into
the selected clients. Therefore every skill must contain its own scripts,
references, and assets. Runtime behavior must not depend on arbitrary files at
the source repository root.

Use `--copy` when symlinks are unavailable. Both modes are release gates. Use
`--list` to inspect discovery without installing, and install into a disposable
project for packaging tests.

The full pack is the simplest route. Selective installs are supported when the
documented required siblings are included; `selfhost` is the core dependency
for catalog-backed capabilities.
