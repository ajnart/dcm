# Planning contract

## Plan shape

A plan contains the resolved goal, selected roles, non-selected alternatives, required sibling skills, approval gates, acceptance evidence, unresolved decisions, and the catalog check date. It preserves the stack capability and reports an effective automation level limited by every selected and implied application. It may summarize non-secret preferences and stale project context. Its human summary explains every selected service and states that the router neither inspected nor changed the host. It has no apply command or mutation authority.

## Composition order

1. Resolve one goal.
2. Inspect the host with `selfhost-host`.
3. Classify existing resources as `reuse`, `coexist`, or `conflict` after ownership and lifecycle are known.
4. Select only necessary capabilities and applications.
5. Present a redacted diff and collect the relevant approval.
6. Apply through the owning capability or adapter.
7. Verify application readiness plus selected edge, VPN, backup, or UI evidence.
8. End with a plain-language summary of services, actions, evidence limits,
   blockers, and the next safe step.

## Mandatory gates

- `storage`: paths, filesystem constraints, free space, permissions, and backup class.
- `exposure`: LAN, tailnet, tunnel, or public; one DNS/TLS/port owner and an authentication policy.
- `privilege`: Docker socket, host networking, devices, capabilities, or root-equivalent access.
- `vpn`: downloader-only scope and a failure-mode kill-switch test.
- `migration`: restorable backup and rollback semantics before a schema-changing upgrade.
- `destructive`: exact bounded target and recoverability before deletion or replacement.

Return `blocked` or `conflict` when evidence is absent. Process liveness and HTTP 200 alone are not acceptance.
