---
name: selfhost-observe
description: Optional observability extension. Create and assess read-only observability plans for self-hosted services. Use for process state, API readiness, dependencies, edge health, storage, backup freshness, logs, metrics, alerts, ownership, or minimal reuse. Keep planned, configured, and observed state distinct and report only supplied redacted evidence.
license: Apache-2.0; see LICENSE.txt
compatibility: Requires Bun 1.4.0 or newer for the bundled planner; accepts redacted facts and evidence only.
---

# Self-host observe

Cover the failure path from process to user-facing edge while preserving the difference between a plan, configuration, and direct observation.

## Workflow

1. Establish the project, services, dependency/ingress/backup scope, and accountable owners. Use `minimal` mode when local health, bounded logs/metrics, and one alert route meet the need.
2. Reuse existing monitoring only after its owner, lifecycle, acceptance, visibility, and protected-admin boundary are explicit.
3. Read [plan-contract.md](references/plan-contract.md). Represent all nine layers and mark dependency, edge, and backup freshness required only when the scope needs them.
4. Run `scripts/plan-observability.ts` with bounded JSON. It makes no request, opens no socket, reads no runtime, and writes no configuration.
5. Resolve missing owners/routing, protected public surfaces, unsafe targets, and Docker-socket gates. Prefer application APIs, runtime CLI output, agents, or an existing monitor over direct daemon access.
6. Present the redacted result. Hand any implementation to an explicitly authorized apply capability, then rerun with independently recorded observations.

## Run the planner

Resolve the script relative to this `SKILL.md`.

```bash
bun <skill-directory>/scripts/plan-observability.ts --input observability-input.json
```

The input accepts structured probe targets and optional `http` or `https` URLs without credentials, query strings, or fragments. Output retains only scheme, host class, and port; it never repeats a hostname, IP address, or URL.

## Hard boundaries

- Keep monitoring administration private. A protected monitor, container manager, identity admin, database, queue, backup console, or runtime control surface published publicly is a conflict.
- Treat a direct Docker socket as host-control risk. Use no socket, a bounded runtime query, or a read-only proxy/agent where possible; require explicit ownership and approval for an existing direct socket dependency.
- Keep logs and labels free of credentials, tokens, cookies, authorization headers, private URLs, and unnecessary personal data. Record retention and a PII policy.
- Treat `planned`, `configured`, and `observed` as distinct states. Only timestamped observations with evidence references and hashes may support `observed-passing`.
- Require an accountable owner for each required layer and at least one owned alert route. Monitoring without a receiver is documentation, not notification.

## Result contract

`pass` means the supplied read-only plan has complete ownership and no policy conflict. It may still be only `planned` or `configured`. `verification.state: observed-passing` is allowed only when every required layer is observed and its checks pass with evidence. `blocked` identifies missing ownership, routing, configuration, or evidence. `conflict` identifies prohibited exposure or unapproved direct Docker control access.

## Completion criteria

Planning is complete when all layers are represented; scope-derived required layers have owners and checks; safe targets are structured and redacted; reused monitoring has an ownership contract; protected administration remains private; Docker access is absent or explicitly bounded; logs/metrics retention and alert routes are owned; state is accurately planned/configured/observed; and no mutation, secret value, raw host, IP, or unsupported verification claim appears.
