# PatchMon traps

## Pitfalls

- Auxiliary Compose services use App-owned names: `patchmon-database`, `patchmon-redis`, `patchmon-guacd`. Keep these names in connection settings and dependencies; persistent data paths stay unchanged.
- Inventory freshness is not proof that patches installed successfully or that reboots completed.
- Redis authentication must remain enabled. Its generated private configuration keeps the password out of command arguments; no Redis healthcheck is claimed because upstream's documented check exposes the password in argv. The server's pinned startup authenticates and pings Redis before serving HTTP; an initial failure exits and relies on its restart policy.
- CORS_ORIGIN derives from the selected loopback origin. A different browser-facing private URL requires separately reviewed origin configuration; a running container is not CORS or dashboard acceptance.
- The pinned headless adapter uses setup-admin, saved-password login, and superadmin profile readback with checkpointed first-owner creation. It requires an owner-selected email and a password satisfying the effective upstream policy; fresh-image and restart acceptance have not been run.
- Login JWTs are short-lived session credentials, not durable integration API keys. Default dashboard Setup creates no Homarr token. The Homarr Link is paused as a Manual step because the actual 2.1.3 server does not provide a read-only statistics credential. No Setup branch creates or adopts an enrollment token, installs agents, enrolls hosts, enables remote access or runs patches.

## Security

- Protect agent enrollment and inventory because they reveal host and package details.
- Keep the server private; protect database, Redis, JWT, session, and AI encryption secrets.
- The actual 2.1.3 image source is Go revision `354ec8cdeb53338e57a8332fb2ddd5c7f307c75c`. Its host enrollment handler accepts active token pairs without checking `integration_type`. Even GetHomepage statistics credentials can enroll hosts; `max_hosts_per_day: 0` is replaced by 100, and a limit of one still grants enrollment authority. A reviewed upstream fix is required before read-only credential provisioning can proceed. See [the source contract and gaps](../../homarr-patchmon-contract.md).
