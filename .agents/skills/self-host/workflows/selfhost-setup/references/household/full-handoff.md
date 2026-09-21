# Full private handoff export

After a full-profile run has a bound household credential bundle, export one
owner-only handoff with:

```text
bun scripts/full-handoff.ts --project-root /absolute/project --run-id RUN_ID
```

The command reads the fixed `.selfhost/stack.json` record, loads household
credentials through their owning validator, and reads a media handoff only from
the recorded media runtime's `artifacts/private-handoff.json`. It writes the
combined private artifact and a separate redacted report beneath
`.selfhost/full/.sessions/<run>/artifacts/`. Both files use mode `0600`; their
parents use mode `0700`. CLI output contains only the two artifact paths.

The private artifact retains media actions, locations, access and MCP metadata,
plus household usernames, generated passwords and captured API keys. Household
URLs and storage paths stay explicitly pending until a later owner records
them. Missing media export or incomplete onboarding produces a partial handoff.
The export always declares acceptance `not-verified`: copying current private
state does not prove that services work or that recorded acceptance remains
current. The redacted report leads with `Setup is not finished` and explains
that generated passwords do not establish application accounts.
