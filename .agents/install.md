# Installation contract

The universal installer is the primary distribution path:

```bash
npx skills@latest add ajnart/selfhost-skills --all
```

The repository is private. `skills` uses existing Git credentials, GitHub CLI
authentication, or SSH; tokens do not belong in the command. A non-interactive
agent-specific install can use, for example:

```bash
npx skills@latest add ajnart/selfhost-skills --skill '*' \
  --agent codex --agent claude-code -y
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
