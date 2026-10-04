# Dockge shared-manager contract

The derived 1.5.0 recipe uses the official image's Docker CLI and Compose
plugin with a separately approved management-mTLS endpoint. This grants
host-wide Docker Engine administration; private stack storage is not an Engine
ACL. Inventory authority is insufficient. No Docker socket is mounted.

The common source-owned `dockerCliTls` profile maps three private owner files to
the Docker CLI's fixed `/run/secrets/ca.pem`, `cert.pem` and `key.pem`, generating
`DOCKER_CERT_PATH=/run/secrets` and `DOCKER_TLS_VERIFY=1`. The pinned manager's
Docker/Compose calls inherit that environment without a local socket or context
override. This is source-backed configuration, not live deployment acceptance.
The exact daemon DNS name, private RFC1918 IPv4 and port are immutable declared
inputs. This profile generates one daemon `extra_hosts` mapping so the CLI
cannot resolve another endpoint through container DNS. The common gate compares
all three fields to the actually approved authority before fresh TLS/local-Engine
identity checks. Arbitrary host overrides remain unsupported.

The common `ownerDirectory` profile generates only
`<saved-project.directory>/data/dockge/stacks`, with identical absolute source,
container target and `DOCKGE_STACKS_DIR`. Startup and setup require a private,
non-symlink, current-host-user-owned directory and the matching numeric
container UID:GID. They also directly compare the approved TLS Engine identity
with the exact local rootful Unix Engine identity. Rootless/remote filesystem
mapping is not assumed. App state uses a separate private bind at `/app/data`.
The interactive main console stays disabled.

The source-pinned `socketio-intents.json` permits only setup, password login
and authenticated settings readback. Fresh account creation requires the
unsolicited empty `setup` event emitted when the startup user-table count is
zero. Absence is not empty-table evidence. The generated password stays private;
a one-time checkpoint precedes setup bytes. Any saved attempted-write checkpoint
resumes password login and never replays setup or deletes the database.
Authenticated `info` must report 1.5.0; public info intentionally hides version.

`SetupEngineIoPolling` owns bounded handshake/frame/ping/ack handling. The
adapter selects only setup/info metadata and its exact approved application
events. Every resume freshly authenticates the saved password and reads
settings with authentication enabled. The password-bound JWT stays ephemeral:
there is no durable API key, token-login shortcut or credential in reports.

Setup readiness covers the verified account, settings and refreshed common
authority/path gates only. Stack-management function, intended-client access
and restart persistence remain separate acceptance. A tile is not a native
Homarr integration.

Sources: [pinned Compose](https://github.com/louislam/dockge/blob/1.5.0/compose.yaml),
[pinned server](https://github.com/louislam/dockge/blob/1.5.0/backend/dockge-server.ts),
[pinned events](https://github.com/louislam/dockge/blob/1.5.0/backend/socket-handlers/main-socket-handler.ts),
[pinned stack commands](https://github.com/louislam/dockge/blob/1.5.0/backend/stack.ts),
[pinned terminal](https://github.com/louislam/dockge/blob/1.5.0/backend/terminal.ts),
[Docker CLI TLS defaults](https://raw.githubusercontent.com/docker/cli/v27.3.1/cli/flags/options.go).
