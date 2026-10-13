# Caddy traps

## Pitfalls

- ACME challenge modes have different port and DNS-secret requirements.
- The bundled recipe exposes only readiness and exact GET /reverse_proxy/upstreams on private port 2015; writable admin stays on container loopback. Upstream statistics do not prove application ingress, and changing a saved recipe requires an explicitly reviewed transition.
- Setup and Check require an explicit upstream array with nonnegative integer active-request and remembered-failure counters. Empty arrays and zero counters are valid; missing fields, redirects and rejected requests are not. Existing Caddyfiles are never rewritten by Setup.
- Homarr 2.4.1 uses this JSON endpoint, not Prometheus /metrics. Its Stats keys are upstreams (configured upstream count), requests (currently active requests), and requestsFailed (remembered passive-health-check failures), not lifetime request totals or proof that a backend is available. The bundled read-only bridge is itself a configured upstream and may contribute an active request during polling.
- Caddy uses no credential for this endpoint. Do not fabricate an API key or make the writable admin API reachable from Homarr; only the existing read-only route is used.

## Security

- Make Caddy the sole approved owner of selected ingress ports.

## Homarr source activation

- Retained registry custodian normally merged frozen main `6b82c55fb890c11a1388bd4e5a2f10b632ff4f7c`, preserving reviewed leaf `2cf41e1301fc3fb55eb1e5c00f5edaf8f52332bc`; only `caddyTarget()` is registered in this branch.
- The branch forward-merges frozen Stats SDK `ecc21d9f95664ef6245863ddfb05930bf4cde3a3`. Native `verify` retains direct bridge verification; the pure `stats` callback validates all three counts against the same central refreshed sample and catalog, requiring `count` units and finite nonnegative integers, including explicit zeros. Each verification refreshes once; Step's apply and post-check remain separate invocations. Nil and unmigrated descriptors keep their existing behavior; no additional peer is registered.
- The actual Homarr image revision [Caddy provider](https://github.com/homarr-labs/homarr/blob/3d4150e59f600876b7e308f857b2f21572b75348/packages/integrations/src/stats/providers/caddy.ts) confirms these semantics. Authenticated API `2.4.1`, image tag/revision and tagged research baseline `ebbd4876d25a51151444a009ab596e1154d62880` remain separate identities.
- The normalized source-activated tree passed gofmt, build, both vet gates, all existing tests, TUI/Activity/Caddy/Homarr/Catalog race checks, installer shell syntax and diff checks with `GOFLAGS=-buildvcs=false`; these are source/fake checks, not live peer proof.
- Source-activated is not live verified. Fresh parent-owned final Standards/Spec review and native/rendered/auth-mode, both-installation-order, restart/rerun, ownership/removal/reinstall and genuinely cross-kind shared-binding acceptance remain held. No runtime or changed Access/admin binding is authorized by registration.
