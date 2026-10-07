# What's Up Docker traps

## Pitfalls

- An available tag is not proof that an upgrade is compatible, backed up, or reversible.
- Pinned 9.1.0 registerWatchers creates a default local Docker watcher when none is configured. Available watcher providers are Docker, Kubernetes, Nomad, and Swarm; registry providers look up image updates for watcher-supplied inventory and do not offer a standalone registry-only mode. A web-only Compose container without an approved watcher would not perform useful monitoring.
- Do not expose raw Docker TCP port 2375 publicly or treat Docker socket :ro as an API permission boundary.

## Security

- Do not mount the Docker socket directly; a read-only bind mount does not make Docker API operations read-only. Upstream recommends a Docker socket proxy with CONTAINERS, IMAGES, INFO, VERSION, EVENTS, and PING reads enabled and mutating operations denied. The proxy requires separate exact socket approval and a WUD-only network; never publish its Docker API port by default.
- Keep the web UI private, seed WUD_AUTH_ADMIN_USER and WUD_AUTH_ADMIN_PASSWORD at the narrow apply boundary, and persist WUD state. Do not put the bootstrap password in catalog data or an ordinary report.
- Pinned authenticated POST /api/profile/tokens accepts name and read scopes and returns rawSecret only once; inventory cannot recover it. Any future adapter must checkpoint before creation, save privately, and refuse duplicate creation after an uncertain response. Bearer verification also updates token lastUsedAt and needs an explicit mutation approval.
- WUD_AUTH_ADMIN_USER with PASSWORD or HASH updates the matching user's credentials and administrator role on startup. Plan this as ongoing declarative credential ownership, not an empty-database-only seed. Homarr's pinned native WUD client uses saved Basic username/password on /api/containers; a personal token is not required for that client.
