# Pangolin traps

## Pitfalls

- Auxiliary Compose services use App-owned names: `pangolin-server`. Keep these names in connection settings and dependencies; persistent data paths stay unchanged.
- The full server is not a drop-in answer for a CGNAT-only home host.
- The official installer generates a multi-container public ingress stack and asks for deployment-specific domains and Let's Encrypt email; a loopback-bound shared recipe would not reproduce it.
- Container start does not complete token-based first-admin registration or organization creation.
- The documented no-tunneling mode removes Gerbil and its extra capabilities, but still requires selected dashboard/base domains, HTTPS origin, certificate owner, private server secret, and separately approved Traefik routes. It is not evidence that outbound tunnels work.
- The documented pangctl set-admin-credentials command takes plaintext --password in argv. Do not use it for generated private credentials; a pinned-source HTTP bootstrap with privately captured setup token and replay-safe owner checks is still needed.
- The shared recipe consumes non-secret generated config with SERVER_SECRET_FILE and a distinct generated PANGOLIN_SETUP_TOKEN capability; neither is an administrator password. Existing administrators are not adopted automatically.
- The private administrative proxy installs dashboard/API routing only. It does not install the dynamic resource provider, Badger authentication plugin, public DNS/TLS, Gerbil, WireGuard, organizations or resources.
- Ready means the exact first administrator and saved root-key metadata were read back. It does not prove Integration API authentication/action grants, organization or resource access, intended-client trust or restart persistence.

## Security

- Require separate approval for a public VPS, domain and TLS ownership, and firewall exposure of TCP 80/443 and UDP 51820/21820 before server deployment.
- Keep the initial-setup token from container logs and connector credentials out of plans, reports, and screenshots; verify the first admin and organization separately.
- Gerbil's NET_ADMIN/SYS_MODULE capabilities and Traefik's shared Gerbil network namespace require a separately reviewed privilege boundary; ordinary app setup must not grant them.
