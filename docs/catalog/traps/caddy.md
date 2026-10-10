# Caddy traps

## Pitfalls

- ACME challenge modes have different port and DNS-secret requirements.
- The bundled recipe exposes only readiness and exact GET /reverse_proxy/upstreams on private port 2015; writable admin stays on container loopback. Upstream statistics do not prove application ingress, and changing a saved recipe requires an explicitly reviewed transition.

## Security

- Make Caddy the sole approved owner of selected ingress ports.
