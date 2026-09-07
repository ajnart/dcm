# CLI contract

## Selfhost router

```text
plan [goal...] --project-root ABSOLUTE [--select role=app] [--json]
catalog menu|list|search|show|homarr|validate [--json]
state init|revise|checkpoint ... --project-root ABSOLUTE [--json]
preferences init|show|set|validate ... [--json]
```

`plan` is read-only. With a goal it resolves and plans against confirmed
non-secret preferences. Without a goal it resumes the exact supplied project
root. Ambiguity, composition, missing approval, and ownership conflict return
structured limitations without mutation.

JSON commands use:

```json
{
  "schemaVersion": 1,
  "status": "pass",
  "command": "plan",
  "mutation": false,
  "data": {},
  "decisions": [],
  "limitations": [],
  "summary": ""
}
```

Exit `0` means pass or warning, `1` an unexpected internal failure, `2` invalid
usage, `3` a safety or evidence block, and `4` an ownership or state conflict.

## Stack lifecycle

Resolve the installed `selfhost-setup` directory and run its Bun TypeScript
CLI. It never installs or applies by itself; explicit setup/upkeep agents
execute the returned prerequisite commands and delegate each approved change.

```text
bun scripts/stack.ts profiles [--json]
bun scripts/stack.ts prerequisites --profile ID [--profile ID] --agent ID --scope project|global [--project-root ABSOLUTE] [--verify-browser] [--json]
bun scripts/stack.ts init --project-root ABSOLUTE --profile ID [--adapter selfhost-media --run-id ID] [--service ID=OWNER] [--consume PROFILE=SERVICE] [--json]
bun scripts/stack.ts show|validate --project-root ABSOLUTE [--json]
bun scripts/stack.ts resume --project-root ABSOLUTE [--json]
bun scripts/stack.ts extend --project-root ABSOLUTE --profile ID [--adapter selfhost-media --run-id ID] [--service ID=OWNER] [--consume PROFILE=SERVICE] [--json]
bun scripts/stack.ts checkpoint --project-root ABSOLUTE --stage planned|applied|verified [--evidence TYPE:ID] [--json]
```

`profiles` and the first `prerequisites` pass resolve the checked `basic`, pack,
and extension closures without mutation. Project-scoped checks require
`--project-root` so installed-skill detection and returned command working
directories match the requested client and scope. Supported common IDs and
their exact targets are in
[`coding-agents.json`](../.agents/skills/selfhost-setup/references/coding-agents.json).
After the returned installs are approved and run, repeat `prerequisites` with `--verify-browser`; that pass uses
the official browser doctor and may clean stale agent-browser daemon sidecars.
`init`, `extend`, and `checkpoint` write only private
`.selfhost/stack.json`. `--consume PROFILE=SERVICE` explicitly binds extensions
to the recorded service IDs they affect. `show` and `validate` are read-only. Media metadata
points to a private `connections.env` containing URLs, usernames, and API keys;
it records no initial password. Before `applied`, `resume` reports that adapter
connection state is pending so interrupted setup can continue. At `applied` or
`verified`, it delegates a secret-free exact connection-file check to the
recorded adapter and fails closed on drift.

## Skill-pack maintenance

```text
bun scripts/skillpack.ts inspect [--json]
bun scripts/skillpack.ts audit [--json]
bun scripts/skillpack.ts validate --scope metadata|content|package|public|all [--json]
bun scripts/skillpack.ts test --skill ID|--changed-from REF|--all [--json]
bun scripts/skillpack.ts index --check|--write [--json]
bun scripts/skillpack.ts benchmark [--runs COUNT] [--json]
bun scripts/skillpack.ts release-check [--tag TAG] [--json]
bun scripts/skillpack.ts package [--version VERSION] --output DIRECTORY [--json]
```

When omitted, the release tag and package version derive from the registry.
The package command rejects non-empty or symlinked output directories and
symlinked inputs, projects canonical
skills into one native `skills/` tree, normalizes ZIP metadata, builds twice in
memory, and compares the resulting bytes before writing release artifacts.

The benchmark runs the catalog menu and two representative plans repeatedly.
Each command must remain within the 500 ms p95 budget; the JSON result records
the Bun version, platform, sample count, timing distribution, and gate result.

The publication audit scans non-sensitive Git text blobs for credential
patterns without printing matched values, reports sensitive historical paths
without reading them, inspects PNG metadata chunks and SVG active resources,
and records preserved-history identity and manual screenshot-review decisions.
`release-check` additionally requires tag/version parity and a dated changelog
heading before publication.
