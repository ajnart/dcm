# Returning project contract

`.selfhost/project.json` remembers the selected goal, exact role choices, plan
fingerprint, catalog source, last recorded workflow checkpoint, and bounded evidence IDs. It is
private local state, separate from `.selfhost/preferences.json`.
Its strict schema is
[`catalog/schemas/project-state.schema.json`](catalog/schemas/project-state.schema.json).

It is also separate from `.selfhost/stack.json`. The router may create or
revise `project.json` while planning, but only explicit `$selfhost-setup`
creates `stack.json`; explicit `$selfhost-upkeep` resumes or extends that stack
record. Neither saved file replaces fresh host inspection or direct evidence.

The first state write also creates `.selfhost/.gitignore` with a wildcard rule,
so installed use does not depend on the target repository already ignoring
local state. The state directory is mode `0700`; its records, ignore file, and
short-lived shared preference/project update lock are private. A leftover
`.project.lock` blocks writes; confirm no update is active before removing that
exact stale lock.

The record never contains credentials, raw host observations, Compose content,
container configuration, absolute artifact paths, or evidence payloads. The
source path for an external catalog is non-secret project identity, not an
artifact path. Version 3 records its canonical directory and SHA-256 of parsed
catalog data plus loaded recipes. A returning run uses that directory without
requiring `--catalog-dir`; an explicit different source is rejected. Source
drift is visible in a read-only plan and requires `state revise` before any
new checkpoint. External-catalog apply and verification checkpoints remain
unavailable until a source-bound deployment adapter exists. An
evidence ID names proof held by the owning capability; it does not make that
proof current.

Older version 1/2 records remain readable. Run `state revise` with the same
goal before a new checkpoint; that explicit migration records the bundled
source and resets stale progress. State writes recheck the selected source
fingerprint while holding the project update lock.

## Resume order

1. Use the user's exact absolute project root, or the current project when its
   `.selfhost/stack.json` or `.selfhost/cli.json` identifies this stack. Without
   either, use the shown default `$HOME/.selfhostedskills`; if another project
   is intended, ask for its root. Do not search elsewhere for project state.
2. Load the project record and confirmed non-secret preferences.
3. Rebuild the plan against the current catalog and report any drift. Preserve
   the selected Homarr state; newly added optional roles stay off unless their
   saved selections explicitly enable them.
4. Run a fresh bounded `selfhost-host` inspection. Treat the saved checkpoint
   and evidence IDs as stale until their owners revalidate them.
5. Prove ownership before classifying each relevant resource as `reuse`,
   `coexist`, or `conflict`. A matching name is not ownership evidence.
6. Continue from the first incomplete safe stage. A changed service choice uses
   `state revise`, which clears the old checkpoint and evidence IDs.

`state init`, `state revise`, and `state checkpoint` write only private local
state. `plan --project-root` resumes read-only.
Checkpoint stages advance one step at a time. `inspected`, `applied`, and
`verified` require a typed opaque evidence ID; the checkpoint command records
the ID but does not perform or verify the work itself.

On the first run, initialize the record after the goal and services are
confirmed. Record `inspected` only when the host capability returned a fresh
typed inspection ID, then record `planned` after the matching plan and
ownership decisions were reviewed. If that evidence is unavailable, keep the
earlier checkpoint. Never infer progress merely because a command was expected
to run.

## End summary

Every user-facing run ends with: what happened; each selected service and its
plain-language purpose; remembered context; current inspection limitations;
what changed or stayed unchanged; blockers; and the next safe action. Never
claim reuse, apply, or verification when the responsible capability did not
provide current evidence.
