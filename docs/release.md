# Release gate

Version 1 releases preserve Git history and publish one generated Agent Plugins
1.0 archive with a Claude Code compatibility manifest. The source of truth
remains `.agents/skills/`; never commit a second `skills/` tree or a portability
symlink.

## Prepare

1. Update the same semantic version in `package.json`, the registry, and both
   files under `packaging/`. CI derives the archive version from the registry.
2. Replace `Unreleased` in the matching changelog heading with an ISO date.
3. Regenerate discovery files with `bun scripts/skillpack.ts index --write`.
4. Review every changed skill against its owning contract and keep generated,
   secret, session, evidence, and client-install state out of Git.

## Prove

Run only the release gates:

```text
bun scripts/skillpack.ts validate --scope all
bun scripts/skillpack.ts audit
bun scripts/skillpack.ts test --all
bun scripts/skillpack.ts benchmark --runs 5
bun scripts/skillpack.ts release-check --tag v1.0.0
bun scripts/skillpack.ts package --version 1.0.0 --output dist
```

The audit never reads a sensitive historical path or prints a matched value.
Review tracked screenshots visually for host details, user data, and credentials
even when their PNG/SVG metadata scan passes.

Extract the ZIP into a disposable directory. Validate root `plugin.json`
against Agent Plugins 1.0, validate every immediate `skills/<name>/SKILL.md`
against Agent Skills, and run the current Claude plugin validator against the
same directory. Validate the ZIP and `SHA256SUMS`, then remove the disposable
files.

The package projection removes only the source-only
`disable-model-invocation` key from explicit workflows. Their standard
`metadata` marker and in-body activation gate remain, and Codex retains its
`agents/openai.yaml` policy. Source installs keep the client-native key.

## Publish

Create the signed or annotated `v<version>` tag only after every gate passes.
The tag workflow rebuilds the archive, rechecks version/date parity, and uploads
the ZIP, manifest, and checksum as one workflow artifact. Creating a GitHub
release or submitting the archive to the universal plugin directory remains a
separate external publication action.
