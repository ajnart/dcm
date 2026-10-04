# Traefik catalog recipe, 2026-09-29

The candidate is deliberately a private process-readiness install, not a working ingress controller. The official Traefik image is pinned to `traefik:v3.6.22`. Its only published port is container 8080 on the shared Compose model's loopback default. Traefik's documented `--ping=true` and `--ping.entryPoint` flags expose `GET /ping`; the adapter checks that endpoint and records only `private-health-ready`. There is no dashboard, Docker provider, socket mount, dynamic route, ACME resolver, or TLS key material. `privateFiles: []` correctly expresses no account or generated key.

This does not fulfill a request to reverse-proxy an application. That needs a separately approved route and one owner for DNS, TLS, ports 80/443, and authentication. If Docker discovery is chosen, the Docker API boundary also needs explicit ownership; this recipe never assumes a direct socket mount. No Homarr integration readiness is inferred from ping.

Official sources:

- [Traefik official image](https://hub.docker.com/_/traefik/)
- [Traefik v3.6 ping and healthcheck](https://doc.traefik.io/traefik/v3.6/reference/install-configuration/observability/healthcheck/)
- [Traefik v3.6 entrypoints](https://doc.traefik.io/traefik/v3.6/reference/install-configuration/entrypoints/)
- [Traefik v3.6 Docker provider](https://doc.traefik.io/traefik/v3.6/reference/install-configuration/providers/docker/)
- [Traefik v3.6 API and dashboard](https://doc.traefik.io/traefik/v3.6/reference/install-configuration/api-dashboard/)

Validation: focused Bun build of `setup.ts` passed. Repository catalog validation reached unrelated Emby recipe errors after Traefik's earlier image-status and source errors were corrected. No Docker run or live `/ping` check was performed.
