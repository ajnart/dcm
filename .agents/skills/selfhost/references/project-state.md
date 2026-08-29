# Returning project contract

`.selfhost/project.json` remembers the selected goal, exact role choices, plan
fingerprint, last recorded workflow checkpoint, and bounded evidence IDs. It is
private local state, separate from `.selfhost/preferences.json`.
Its strict schema is
[`catalog/schemas/project-state.schema.json`](catalog/schemas/project-state.schema.json).

The first state write also creates `.selfhost/.gitignore` with a wildcard rule,
so installed use does not depend on the target repository already ignoring
local state. The state directory is mode `0700`; its records, ignore file, and
short-lived shared preference/project update lock are private. A leftover
`.project.lock` blocks writes; confirm no update is active before removing that
exact stale lock.

The record never contains credentials, raw host observations, Compose content,
container configuration, absolute artifact paths, or evidence payloads. An
evidence ID names proof held by the owning capability; it does not make that
proof current.

## Resume order

1. Use the exact project root supplied or confirmed by the user. Do not search
   unrelated directories for project state.
2. Load the project record and confirmed non-secret preferences.
3. Rebuild the plan against the current catalog and report any drift. A newly recommended optional role stays off unless its saved selection explicitly enables it.
4. Run a fresh bounded `selfhost-host` inspection. Treat the saved checkpoint
   and evidence IDs as stale until their owners revalidate them.
5. Prove ownership before classifying each relevant resource as `reuse`,
   `coexist`, or `conflict`. A matching name is not ownership evidence.
6. Continue from the first incomplete safe stage. A changed service choice uses
   `project revise`, which clears the old checkpoint and evidence IDs.

`project init`, `project revise`, and `project checkpoint` write only private
local state. `project status` and `project resume` are read-only.
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
