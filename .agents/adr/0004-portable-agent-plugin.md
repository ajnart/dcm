# ADR 0004: Publish one portable Agent Plugin from canonical skills

Status: accepted on 2026-09-07

## Context

Agent Plugins 1.0 discovers skills only from immediate child directories under
root `skills/`; `plugin.json` cannot list or redirect them. Project-local skill
development remains canonical under `.agents/skills/`, which is also the shared
directory used by several coding agents. Committing both trees would create two
editable sources and a permanent drift risk.

Agent Skills frontmatter is closed. The setup and upkeep sources also need the
client-native `disable-model-invocation` safety guard, while the portable format
has no standardized invocation-policy field.

## Decision

Keep `.agents/skills/` as the only editable skill tree. Build the release ZIP
with root `plugin.json` and one flat `skills/<name>/SKILL.md` directory per
registered skill. Keep client-specific data out of the closed portable
manifest. Retain the Claude compatibility manifest separately.

For explicit workflows, preserve the source-native invocation guard, standard
`metadata` marker, in-body activation gate, and Codex policy. Remove only the
non-standard top-level key from the generated portable `SKILL.md` files. Reject
unknown packaged frontmatter fields and any missing immediate skill path.

Maintain one checked common-agent registry for installer IDs and project/global
targets. Let the Skills CLI handle installation; do not duplicate client path
logic in documentation.

## Consequences

- The release archive conforms to Agent Plugins 1.0 and Agent Skills without a
  second committed skill tree.
- Source installs retain stronger client-native activation controls.
- Codex, Claude Code, Cursor, GitHub Copilot, Gemini CLI, OpenCode, Cline,
  Windsurf, Kiro CLI, Pi, Roo Code, and Amp use one compatibility registry.
- Adding an agent requires one registry change plus the focused setup and
  installer compatibility checks.
