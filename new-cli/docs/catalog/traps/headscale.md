# Headscale traps

## Pitfalls

- The hosted container guide is community-maintained and explicitly not developer-verified. Its read-only root, writable /var/run/headscale tmpfs, read-only /etc/headscale config mount, and persistent /var/lib/headscale need pinned-source and image verification. The version-matched config defaults server_url and listen_addr to 127.0.0.1, which cannot serve real clients unchanged; container listen_addr must bind an interface reachable from the published port.
- First identity setup is headscale users create <USER>; headscale users list resolves its ID; headscale preauthkeys create --user <USER_ID> issues a default one-hour, single-use registration key. A safe setup adapter would need bounded local CLI execution, private capture of the one-time key, and replay-safe inspection without putting it in argv, logs, or ordinary reports.
- Control-plane failure can block enrollment and make recovery circular.
- A loopback /health response cannot prove the configured server URL, DNS/TLS route, node registration, or mesh traffic. Require a real client enrollment and peer connectivity check before acceptance.
- headscale apikeys create prints the API key only once and defaults to a 90-day expiry; list returns prefixes and metadata, not the credential. Reuse checkpointed container.exec and private secrets.writeApiKey rather than an app-specific command router; their crash window still needs a capture/reconciliation contract distinct from admin-password capture. A lost create response cannot be recovered by listing keys or justify automatic re-creation.
- The derived recipe binds the reviewed canonical HTTPS identity into server_url. API-key setup uses the saved private loopback origin; it does not install ingress, establish client DNS/TLS trust, or prove the required control-protocol proxy behavior. Those remain separate approvals and acceptance gates.

## Security

- Protect one-time API and node-registration keys, local CLI/socket administration, and the SQLite/private-key state. A Headscale user is a node identity, not a password-based administrator account; a preauthkey enrolls a node and is not an API key.
- Assign one approved DNS/TLS/443 owner before making the control plane reachable to clients. A reverse proxy must support Headscale's POST WebSocket upgrade with the tailscale-control-protocol header; Cloudflare Proxy and Tunnel do not. Keep metrics and gRPC administration private.
