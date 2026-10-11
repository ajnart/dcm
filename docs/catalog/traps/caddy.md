# Caddy traps

## Pitfalls

- ACME challenge modes have different port and DNS-secret requirements.
- The bundled recipe exposes only readiness and exact GET /reverse_proxy/upstreams on private port 2015; writable admin stays on container loopback. Upstream statistics do not prove application ingress, and changing a saved recipe requires an explicitly reviewed transition.
- Setup and Check require an explicit upstream array with nonnegative integer active-request and remembered-failure counters. Empty arrays and zero counters are valid; missing fields, redirects and rejected requests are not. Existing Caddyfiles are never rewritten by Setup.
- Homarr 2.4.1 uses this JSON endpoint, not Prometheus /metrics. Its Stats keys are upstreams (configured upstream count), requests (currently active requests), and requestsFailed (remembered passive-health-check failures), not lifetime request totals or proof that a backend is available. The bundled read-only bridge is itself a configured upstream and may contribute an active request during polling.
- Caddy uses no credential for this endpoint. Do not fabricate an API key or make the writable admin API reachable from Homarr; only the existing read-only route is used.

## Security

- Make Caddy the sole approved owner of selected ingress ports.
