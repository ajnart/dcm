# Beszel selected existing paired-system acceptance

Source-backed helper and synthetic fixture only: zero live acceptance credit. No Docker, browser, agent enrollment, private runtime inspection, remote workload requests, host-control change or public exposure was performed.

## Pinned contract

Beszel recipe `henrygd/beszel:0.20.0` deploys only the Hub. Existing `setup.ts` verifies its fixed private `admin@example.test` Hub admin and separate PocketBase superuser, but explicitly creates no general REST API token. This helper does not guess or repeat first-account setup.

- [Beszel v0.20.0 dependency pin](https://github.com/henrygd/beszel/blob/v0.20.0/go.mod) uses PocketBase `v0.40.4`.
- [Pinned collection snapshot](https://github.com/henrygd/beszel/blob/v0.20.0/internal/migrations/0_collections_snapshot_0_20_0.go) defines 15-character lowercase alphanumeric system/user/history IDs, the users self-read rule, system configuration, `info`, and `system_stats` fields/intervals.
- [Pinned authorization setup](https://github.com/henrygd/beszel/blob/v0.20.0/internal/hub/collections.go) applies authenticated system membership rules. `SHARE_ALL_SYSTEMS` can relax read permissions, so the helper also checks explicit `users` membership. Stats have a list rule but no regular-user view rule: history must use a bounded filtered list, not a direct stats-record GET.
- [Pinned metrics model](https://github.com/henrygd/beszel/blob/v0.20.0/internal/entities/system/system.go) identifies agent uptime and CPU/memory/disk metrics. The helper requires an UP system, positive uptime, recent timestamps within five minutes (30-second future-skew tolerance), valid percentages and positive memory/disk capacities. Empty Hub health is insufficient.
- [Beszel REST guide](https://beszel.dev/guide/rest-api) documents users password authentication and PocketBase collection reads, warning that minor versions may change data structure. Current guide is 0.21.0; pinned source above governs this helper.
- [PocketBase authentication](https://pocketbase.io/docs/authentication/) and [record API](https://pocketbase.io/docs/api-records/) document private auth tokens and authorization-governed record reads. Context7 resolved `/websites/pocketbase_io` and fetched current token/self-read documentation on 2026-10-03; pinned Beszel source supplies the ownership rules.

## Scoped behavior

The reviewed `beszel.system-id` selects exactly one pre-existing paired system. The common lifecycle factory binds inputs, completed shared owner, exact Beszel Hub unit/image, baseline epoch, recorded stop, distinct restart and compare-and-set checkpoint lineage. Its one declared authentication exception permits only approved `POST /api/collections/users/auth-with-password` with action `beszel-acceptance-login`; credentials and response token remain private memory. No account creation, superuser authentication, credential/token storage or refresh is performed.

After login, GET self must prove the saved email, Hub admin role and verified account; GET selected system must prove explicit membership and fresh meaningful paired state. The helper reads at most one latest `1m` stats row with `system` filtering. A baseline contains only identity/system/history IDs, stable configuration SHA-256 (name/host/port/sorted users), and a canonical original-history SHA-256 (ID/system/type/time plus numeric CPU/memory/disk projection). No email, host address, password, token or raw stats enter checkpoint/results.

On resumed begin and after the exact Hub restart, the original history ID is reused through a separate filtered list. A newer sample cannot replace the original. Finish additionally requires recent current paired stats and exactly matching original history/configuration hashes. This proves only selected-system stats/history reads and scoped Hub restart persistence when live execution succeeds, not agent creation, all host metrics, remote-device acceptance or rendered charts.

## Validation and remaining evidence

Passed `packages/cli/tests/beszel-read-acceptance.test.ts` and focused syntax builds of the helper and fixture using Bun 1.4.0. Synthetic coverage includes missing/invalid inputs, missing password, wrong auth collection/identity, auth/read denial, missing membership, pending/stale systems, missing or meaningless stats, immutable historical baseline, missing original history despite a later sample, configuration/history changes and foreign units/owner/restart chronology. The fixture also verifies packaged contract loading, `opaque-id` validation and refusal to award persistence when paired stats/history proof is absent.

A live completed owner with the saved account, one separately approved/enrolled existing paired system, recent meaningful stats and approved Hub stop/start remains required for any receipt. The Hub-only recipe alone cannot satisfy this workload. No live account, paired agent, recent metrics or restart persistence was inspected in this task.
