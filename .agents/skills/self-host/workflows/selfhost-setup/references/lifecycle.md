# Stack lifecycle contract

`.selfhost/stack.json` is the private continuation record shared by setup and
upkeep. It stores selected profiles, their resolved skills, service ownership,
one adapter runtime pointer, and typed checkpoint evidence. It stores no secret
value.

The install profile manifest declares whether each profile has no service
consumption or requires explicit bindings, plus the exact `approval:` and
`verify:` evidence IDs it requires. `.selfhost/stack.json` records each binding
as one profile ID with a sorted non-empty list of existing service IDs. Create
them with repeated `--consume PROFILE=SERVICE`; an unrelated service record
cannot implicitly satisfy an extension. Resolved obligations are additive:
selecting a pack or extension retains every `basic` obligation and adds only
its own.

For the media pack, `connections.path` points to the adapter-owned mode-`0600`
`connections.env`. That file may contain local URLs, usernames, and API keys so
later extensions can wire services without repeating onboarding. It never
contains the generated admin password. When saved credentials are explicitly
requested, `handoff` writes `.sessions/<run>/artifacts/private-handoff.json`
(mode `0600`) with the generated password, usernames, available API keys, URLs
and storage paths. Return only its path and the redacted report. Export does
not establish acceptance, and upkeep exports again only when requested.

## Transitions

```text
selected -> planned -> applied -> verified
```

- `init` records selected profiles before apply.
- `extend` adds one or more profiles and returns to `selected` without removing
  existing service records.
- `planned` requires new `plan:` evidence. `applied` requires new `apply:` or
  `manifest:` evidence plus every selected profile's `approval:` IDs.
  `verified` requires every selected profile's declared `verify:` IDs; the
  media pack names all seven services, browser proof, and relationship proof.
- Repeating a stage is allowed only to append fresh evidence.

The `full` profile also records an optional checkpoint on each household
service. Absence means `selected`; `service-checkpoint` advances one service
through `planned`, `applied`, and `verified` with new typed evidence at every
write. These records do not claim that Compose or onboarding ran. They record
evidence produced by the owning stage. A global `verified` checkpoint is
rejected until every household service is verified.

```text
bun scripts/stack.ts service-checkpoint --project-root ABSOLUTE \
  --service SERVICE --stage planned|applied --evidence TYPE:ID
bun scripts/stack.ts service-checkpoint --project-root ABSOLUTE \
  --service SERVICE --stage verified --evidence verify:ID \
  --evidence-file ABSOLUTE_PROJECT_ROOT/.selfhost/evidence/REPORT.json
```

A verified household service requires a current, non-secret acceptance report
owned by the project user, mode `0600`, with no symlink or extra hard link. Its
run ID must match the recorded full-stack media run. Required passing checks are
account login, storage and private access, plus Homarr integration and widget
data for supported apps. Vaultwarden instead requires its Homarr shortcut,
closed registration and recovery evidence. The checkpoint stores only the
relative report path and SHA-256 digest. `resume`, validation and global
verification re-read the protected report and reject changed, stale, incomplete
or mismatched evidence. This binds observation records; it does not prove their
truth cryptographically.

The report is exact JSON with `schemaVersion: 1`, kind
`household-acceptance`, the household `service`, the recorded media `runId`, a
recent UTC `checkedAt`, an identifier-valued `observer`, and `checks`. Each
check is `{ "id": ID, "status": "pass", "evidenceRefs": [REF] }` with at
least one non-secret observation reference. Non-Vaultwarden reports use exactly
`account-login`, `private-access`, `storage`, `homarr-integration`, and
`homarr-widget`. Vaultwarden uses exactly `account-login`, `private-access`,
`storage`, `homarr-shortcut`, `registration-closed`, and `recovery`.

Every write uses the private `.selfhost` directory, a no-follow update lock,
an exclusive stale-lock recovery claim, mode `0600`, atomic replacement, and
the existing wildcard `.gitignore`. A live owner is never displaced based on
age; an interrupted recovery claim fails closed for manual inspection.
Commands return metadata and connection paths but never emit API keys.
Before `applied`, `resume` reports recorded adapter connection state as pending
so an interrupted setup can continue before the runtime or file exists. At
`applied` and `verified`, it delegates connection-file validation to the
recorded adapter and returns only its pass/fail classification; upkeep never
receives file contents.

Bind an existing household credential run to the full continuation record with
`bun scripts/stack.ts bind-household --project-root ABSOLUTE --run-id ID`. The
run ID must equal the recorded media orchestration run and its owner-validated
handoff must select exactly the five full-profile household services. Metadata
stores only that run ID and the relative private-handoff path. `resume` reports
`missing-unbound`, `valid`, or `invalid` without regenerating or emitting any
credential. Full global verification requires a valid binding; a removed or
unsafe handoff is detected on resume.

## Full stack stages

For `full`, follow the planner's `setupStages` in order. Execute the media
stage through `selfhost-media`, then apply the selected household apps through
`selfhost-compose` using current official installation instructions. Reuse the
media stage's Homarr. Add each ready household app to its personal board and
configure a supported integration where available; a shortcut is not proof of
an integration. Keep each stage pending until its account, storage, access and
service checks pass. Media success cannot mark the entire full stack verified.
Do not silently omit guided stages or deploy a second Homarr.

Load only the selected household recipe before its stage:

- [Immich](household/immich.md)
- [Nextcloud](household/nextcloud.md)
- [Navidrome](household/navidrome.md)
- [Audiobookshelf](household/audiobookshelf.md)
- [Vaultwarden](household/vaultwarden.md)

For the Navidrome, Audiobookshelf, and Vaultwarden Compose stage, use the
[household manifest builder](household-plan.md). It delegates generic manifest
validation, planning, and rendering to `selfhost-compose`; it does not create
storage or apply the plan.

`resume` reports the next pending stage for every unverified household service,
even when the media adapter is healthy. Continue that service from its recipe's
resume branch and record only newly observed evidence.

For a requested full-stack credential export, follow the [combined handoff](household/full-handoff.md). It collects the existing media export and bound household credentials into one private artifact and writes a separate redacted report. Exporting is never an acceptance check and does not run automatically on upkeep.
