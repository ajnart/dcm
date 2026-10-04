# Household CLI setup

Use this procedure for the bounded media + Immich + Docmost + Vaultwarden
bundle, including continuation of its existing project. The general setup
workflow still owns intake, prerequisites, approvals, and the user summary.

## Prepare and resume

For a fresh bounded media + Immich + Docmost + Vaultwarden household
request, use `bundle begin --project-root "$PROJECT_ROOT" --id BUNDLE_ID`
with the confirmed account identity, private HTTPS origin and owners, and
`--resolve-images` or four reviewed immutable image references. It starts
the current owner-only monotonic journey before the bundled host probe,
checks exact selected ports, creates the bounded owner-only inputs without
overwriting, and prints `bundle plan`. It defaults new media to host-only
binding and leaves HTTPS readiness pending. It does not apply anything.
To extend one existing CLI-managed media run in the same project, use
`bundle begin --media-run-id RUN_ID` with the same account identity and only
three new app ports. The initializer verifies seven running services, its
private credential handoff, and the unchanged approved media plan; the bundle
records its exact bind and ports. Keep that run's existing bind, ports,
networks, and data: omit all `--media-bind-mode`, `--media-port-start`, and
`--media-network-subnets` flags. Bundle media `prepare` is a read-only status
check for adopted runs; bundle media `apply` and `resume` are refused. Use the
media CLI's own upkeep commands when needed. Review `mediaSelection` and `mediaExposure`
in the returned plan before approving the extension. An adopted media run
predates this journey, so `bundle benchmark` marks fresh full-stack speed
not comparable even if the extension journal finishes.
The terminal menu rechecks a private firewall assertion when resuming an
adopted all-interface run. It can advance multiple reviewable checkpoints in
one session, with a fresh exact plan and separate approval at each gate; it
stops at manual browser, Homarr, recovery, failure, or the session cap. At the
host-only `vaultwarden.localhost` HTTPS gate it can run the reviewed Caddy
input and apply stages, bind the exact Vaultwarden bridge, and record only the
operator's explicit loopback-resolution and intended-client CA-trust assertion.
Custom and existing routes remain with their owner. Saved Caddy inputs and a
current applied checkpoint are resumed; ambiguous or stopped checkpoints use
the Caddy owner's status and recovery approval instead of replaying apply.
Use `bundle journey status` for read-only same-boot elapsed time; the journal
never reconstructs earlier work. If preparation stops after its journal
starts, use the separate `inspect-host`, `bundle init`, and `bundle plan`
steps to resume from the recorded owner-only paths rather than repeating
`begin` or fabricating elapsed time.

For host inspection, use `--limit 50` and check the three app ports plus
seven exact media ports when `--media-port-start` is selected. Keep selected
checks at or below the inspector's 16-port cap; a future Caddy port may be
checked in the same report. The CLI accepts extra complete checks.

If Docker has exhausted automatic address pools, inspect all Docker
subnets and host routes before choosing two non-overlapping private CIDRs
for `--media-network-subnets DEFAULT_CIDR,WEB_CIDR`. This changes only the
new media project's networks; never prune or reconfigure other owners.
Immich, Docmost, and Vaultwarden each have their own optional reviewed
`--*-network-subnet` choice during `bundle init`; do not reuse a subnet.

## Review and apply

`bundle plan` fingerprints the owner-controlled input and its references.
Use `bundle run` to inspect all four adapters and
advance through only the safe CLI stages whose exact approvals were already
supplied or recorded. It returns one structured resume checkpoint at the
first missing adapter approval or manual browser/private-HTTPS gate. Re-run
the same command with only the newly reviewed token; adapter-owned state
makes this resumable. Use read-only `bundle approvals --project-root
"$PROJECT_ROOT"` to show the current bundle token, service gates, exact
review command, and next adapter token when available. Inspect its full
plan and adapter facts before seeking approval; the inbox is not
authorization. Use read-only `bundle next` when execution is not
wanted, `bundle stage` to delegate one checkpoint directly, and `bundle
status` to aggregate all adapter checkpoints without
treating them as acceptance. The bundle approval authorizes only the
unchanged composition; each
adapter keeps its own exact apply approval and resume state. Private HTTPS,
Docmost owner API approval or protected browser fallback, direct acceptance,
and Homarr attachment remain visible checkpoints rather
than bundle success claims.

Running media containers do not prove setup finished. The coordinator checks
the bounded recorded workflow outcome: failed setup returns its exact read-only
diagnosis command; missing or incomplete evidence returns benchmark inspection.
Repair and resume the recorded failed stage under its existing approval rather
than replaying setup. An explicitly pending indexer choice stays unaccepted;
completed command stages are neither live acceptance nor whole-journey timing.

For a newly managed Docmost workspace, the approval inbox includes its
[API app check](docmost-cli.md#deterministic-app-check). Review the full plan,
then use the returned resume arguments with its separate exact token. Recorded
API proof skips only that check, not browser or Homarr acceptance.
A consumed ambiguous attempt stops at readback guidance; verification is manual
and never repeats the upload. Its returned plan/status commands also let this
check progress independently while another account gate waits.

## Private access and account setup

When `bundle next` stops at `verify-vaultwarden-private-https`, verify the
route and CA trust on the intended client. Then use `bundle https-ready`
with the current bundle approval and both explicit HTTPS confirmation flags;
re-plan with the returned approval before Vaultwarden prepare. This records
the owner's assertion on the same bundle, not independent client proof.

At the Vaultwarden account checkpoint, follow [first account and resume](household/vaultwarden.md#first-account-and-resume)
and use its separate bounded `vaultwarden signup plan|apply|status` approval
for newly prepared, originally-new exact pinned runs before any manual signup.
Legacy or already-attempted runs use only the exact existing-account
`loginCommand` returned by `bundle next` for fresh-login reconciliation.

For a new media run that will serve the shared private Caddy route, apply
media first. Before Immich or Docmost apply, refresh the host inspection and
use `bundle route-network --service media-web` with the current bundle
approval to bind only their app containers to the verified internal media
web network. Re-plan after the command returns its new approval.
For two untouched app projects, `bundle parallel-plan` may then review the
initial Immich and Docmost applies with a fresh host report checking both
ports. After the user reviews both adapter plans and approves their exact
tokens, `bundle parallel-apply` runs only those two Compose applies in
isolated processes and reports each result. On a partial result, inspect each
adapter checkpoint and resume individually; account, owner, and acceptance
stages remain sequential gates. `bundle run` remains the default single-
checkpoint path.

For a selected host-only shared Caddy route, refresh inspection with an
exact check of the chosen HTTPS port. Run `bundle caddy-inputs plan`, review
and apply its file-only approval, then use the generated input with
`caddy-private plan|apply` under its separate approval. Inspect the new
Caddy-owned internal Vaultwarden bridge, use `bundle route-network` to attach
only Vaultwarden, and re-plan before the HTTPS trust checkpoint. The six
generated `.localhost` names are host-only; LAN clients require a separate
private DNS and client-CA plan.

Once the media-facing routes are verified, use `install media access-proxy
plan|apply` for Homarr, Jellyfin and Seerr, one reviewed origin at a time.
Review/apply its returned `reconcile-links` plan, then a fresh
`reconcile-notebook` plan to refresh dashboard links and the primary recap.
These separate approvals save access metadata and reconcile the private board,
not route or client-trust evidence; Arr and qBittorrent keep private local links
unless separately routed.

## Finalize and measure

The household bundle does not select backup protection. Report recovery as
unverified in the handoff and Homarr recap. If backup protection is selected,
follow `selfhost-backup` and require an isolated restore; before migrating real
vault contents, require the recovery proof in the Vaultwarden guide.

After direct acceptance is complete, create the bound blocked manifest with
`bundle finalize scaffold`, fill only observed evidence, then use `bundle
finalize` with explicit owner-only redacted observation files for all four
apps, Homarr board, widgets, Notebook, read-only Seerr search UI, and MCP,
a hashed redacted screenshot, each stage's
measured start/completion, the end-to-end timestamps, and cleanup state.
Missing or non-passing evidence stays blocked. The checkpoint performs no
live probe, labels complete input as recorded rather than independently
verified, and must not claim an under-ten-minute run without complete
measured timestamps.

Use `bundle finalize status` with the same root, input and evidence flags to
reassess the bound evidence without creating or replacing a checkpoint. It
reports recorded declarations, not a fresh runtime probe or comparison with
an older checkpoint. Missing, invalid or non-passing evidence stays blocked;
valid revised evidence gets a new assessment without updating the checkpoint.

After recorded finalization and cleanup, run `bundle journey finish` with
the same bundle ID and exact input. A reboot, incomplete checkpoint, or
changed evidence hash leaves full elapsed unmeasured.

Use read-only `bundle benchmark` to audit the adjacent finalization timing
and journey journal without opening credential files or probing the stack.
It reports full elapsed only from a finished same-boot journal gated by the
unchanged bundle and complete hash-bound finalization evidence. Individual
phase gaps remain visible; ease stays `not-measured`, and recorded
acceptance stays separate from independent verification.

## Restart and credential handoff

For a later stop or restart of the already-applied bundle, use `bundle down`
or `bundle up` with the unchanged bundle approval. They preflight every
adapter checkpoint and exact Compose file first and never delete volumes or
prune resources. Shared `caddy-private` has a separate lifecycle: read its
exact input/checkpoint status, stop it with the returned `STOP` approval before
`bundle down`, then start it with its returned `UP` approval after `bundle up`.
The optional `--local-https-input`/`--local-https-run-id` flags apply only to
the legacy Vaultwarden local-HTTPS adapter, not shared Caddy. Recheck HTTPS
and direct app acceptance after restart; keep existing accounts and data.

After the four managed credential files exist, use `bundle handoff` for a
single owner-only `.env` export; include Immich's one-time Homarr key with
the conventional bundle-local `immich-homarr-api-key` file when available;
use `--immich-api-key-file` for another owner-only path. Return only the file path and
pending-key names, never its contents or an acceptance claim.
The output is a POSIX-shell-safe private file. Label HTTP URLs as local
links and never imply that the Vaultwarden HTTPS route is trusted on a
second device without that device's own DNS and CA evidence.

## Attach to Homarr

After direct acceptance, use `bundle homarr-inputs plan`, review its one
bundle-and-content-bound approval, then use `bundle homarr-inputs apply`.
It always writes the three owner-only app-shortcut inputs. When Immich has a
validated Homarr-reachable network, it also writes the schema-exact native
Immich attachment input and returns all exact plan commands with the managed
media key-file path. Otherwise it leaves native Immich pending without
blocking the shortcuts. The native plan points to the conventional
bundle-local acceptance record and limited Immich Homarr key; it does not
create either. Docmost and Vaultwarden remain tile-only. Native Immich
attachment and key creation keep their own exact plans and approvals; none
of these generated inputs proves an integration, widget, or runtime.

After the inputs exist, use read-only `bundle homarr-attach status --inspect`
with the exact project root and bundle input for fresh sequential adapter
status. It skips only confirmed attachments and stops at the first unresolved
or unavailable result. Late `bundle next` and the approval inbox expose the
same guidance alongside their account/finalization checkpoint. Without
`--inspect`, the queue checks only file metadata and claims no attachment.
Run each unresolved adapter's exact plan, reviewed apply, and status directly;
then obtain a fresh plan for the next app. A shortcut changes the shared board
snapshot, so approvals cannot be safely precomputed or combined. Missing
inputs require the original approved route selection, including its exact
`--shared-caddy-input` for shared HTTPS; do not downgrade existing links.
Missing native Immich network, limited-key, or acceptance evidence remains a
visible gate. The queue does not reconcile media-owned Homarr, Jellyfin, or
Seerr links.
