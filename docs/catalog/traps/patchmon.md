# PatchMon traps

## Pitfalls

- Auxiliary Compose services use App-owned names: `patchmon-database`, `patchmon-redis`, `patchmon-guacd`. Keep these names in connection settings and dependencies; persistent data paths stay unchanged.
- Inventory freshness is not proof that patches installed successfully or that reboots completed.
- Redis authentication must remain enabled. Its generated private configuration keeps the password out of command arguments; no Redis healthcheck is claimed because upstream's documented check exposes the password in argv. The server's pinned startup authenticates and pings Redis before serving HTTP; an initial failure exits and relies on its restart policy.
- CORS_ORIGIN derives from the selected loopback origin. A different browser-facing private URL requires separately reviewed origin configuration; a running container is not CORS or dashboard acceptance.
- The pinned headless adapter uses setup-admin, saved-password login, and superadmin profile readback with checkpointed first-owner creation. It requires an owner-selected email and a password satisfying the effective upstream policy; fresh-image and restart acceptance have not been run.
- Login JWTs are short-lived session credentials, not durable integration API keys. Default dashboard setup creates no Homarr token. The optional once-returned key/secret pair is saved atomically in a private JSON file, inventory/readback verified and tested against the GetHomepage stats API; lost unsaved secrets require manual reconciliation, not token replay. No setup branch installs root/sudo agents, enrolls hosts, enables remote access or runs patches.

## Security

- Protect agent enrollment and inventory because they reveal host and package details.
- Keep the server private; protect database, Redis, JWT, session, and AI encryption secrets.
- The v2.1.3 host enrollment handler accepts active token pairs without checking integration_type. Even Homarr/GetHomepage statistics credentials can enroll hosts; create them only after explicit credential-authority=stats-and-enrollment choice and exact token approval. The adapter limits them to one host per day and never enrolls a host.
