# Uptime Kuma selected-monitor acceptance

Source-level contract for pinned `louislam/uptime-kuma:2.5.5`; no live instance, Docker restart, target network, or private credential store was accessed.

## Reviewed sources

- [Pinned server](https://github.com/louislam/uptime-kuma/blob/2.5.5/server/server.js): `login` returns `{ ok: true, token }` after authenticating the saved account. `getMonitor(id)` looks up `id AND user_id`, then returns `{ ok: true, monitor }`. `getMonitorBeats(id, 24)` checks login and returns `{ ok: true, data }` from raw heartbeat database rows ordered by time. Because the latter does not check ownership itself, the adapter first requires successful owner-scoped `getMonitor` and validates every returned `monitor_id`.
- [Pinned monitor model](https://github.com/louislam/uptime-kuma/blob/2.5.5/server/model/monitor.js): selected operating fields and active/maintenance flags come from `toJSON`. Sensitive fields, targets, descriptions, headers, and bodies are deliberately omitted from the retained digest.
- [Pinned heartbeat model](https://github.com/louislam/uptime-kuma/blob/2.5.5/server/model/heartbeat.js): status `1` means UP. Raw database rows from `getMonitorBeats` are not the pushed `monitorID` JSON envelopes.
- Context7 resolved the official `/louislam/uptime-kuma` source and retrieved the Internal API login, `getMonitor`, and `getMonitorBeats` signatures; pinned source determines exact runtime shape.

## Boundary

The explicit reviewed positive-integer `monitor-id` must name an existing active, non-maintenance owner monitor with non-empty bounded 24-hour history and a latest UP heartbeat no older than five minutes. Authenticated empty inventory cannot pass. No monitor, status page, notification, target, or probe is created or modified. Socket.IO login/read POSTs retain individual exact-action approvals; namespace-connect/pong alone use the existing control-frame exception.

Begin retains only monitor/heartbeat IDs, hashes of whitelisted operating fields (`id`, `type`, `active`, `forceInactive`, `interval`, `timeout`) and heartbeat fields (`id`, `monitorId`, `status`, `time`, `ping`), and engine owner/unit/image/epoch lineage. It never persists URLs, monitor secrets, JWTs, messages, responses, or their hashes. Repeat begin cannot replace the baseline.

Finish requires owner-provided actual stop/start evidence, identical selected unit/image and owner/recipe/manifest lineage, increasing sequences, distinct evidence IDs, and a new start epoch. It repeats saved-account login and owner-scoped monitor/status reads live, checks unchanged whitelisted operating fields and the exact pre-restart historical heartbeat, and requires recent UP status again. Database readiness retries only a bounded read; denied responses and authentication failures are not retried away.

The historical baseline must remain in the bounded 24-hour window. A delayed finish or very high-frequency history exceeding transport/row bounds blocks rather than replacing history or increasing limits. This proves selected existing monitor status/history readback and narrow operating-field persistence, not complete target configuration equality, monitor creation, uptime SLA, notifications, integrations, or fresh empty-profile acceptance.

## Validation

Only the requested focused synthetic fixture and Bun source builds are run. They exercise empty history rejection, selected owner/ID, current UP status, stale history, immutable-image/owner/epoch lineage, lost historical record, changed configuration/status hashes, exact action denial, readiness failure, bounded transient readiness, and absence of private data in saved checkpoints. Synthetic passing fixtures do not provide live/restart receipts or measured headless acceptance credit.
