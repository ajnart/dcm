# Aria2 traps

## Pitfalls

- An exposed RPC listener can permit arbitrary downloads and filesystem writes within its process authority.
- aria2c listens only on loopback by default; a container RPC listener needs an explicit reachability decision and separate private host binding.
- aria2 has no username account; its RPC token is the control credential, not an administrator password.
- The third-party image's publisher startup passes RPC_HASH in argv and logs a generated secret; do not use it unchanged or bypass the shared recipe's secret boundary.
- The publisher Dockerfile uses root, but aria2 RPC on port 6800 needs no privileged mode, Docker socket, host networking, or host-root mount. A non-root override still needs pinned image and writable-storage evidence.
- Authenticated aria2.getVersion is a read-only control-token check; system.listMethods is allowed without a token and cannot prove authentication. Downloads, session persistence, and VPN safety need separate acceptance.

## Security

- Keep JSON-RPC on a private route and require --rpc-secret before enabling remote control.
- Keep the RPC token out of process arguments, logs, Compose manifests, and ordinary reports.
