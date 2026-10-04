# Tailscale container catalog boundary — 2026-09-30

The official image has a versioned `ghcr.io/tailscale/tailscale:v1.102.4` tag. The manifest remains **guided**, not managed. No `recipe.json` or `setup.ts` was added: the current shared recipe/setup contract cannot safely complete unattended enrollment or prove private access.

## Official runtime contract

- [Docker parameters](https://tailscale.com/docs/features/containers/docker/docker-params) document `TS_AUTHKEY`, `TS_CLIENT_ID` plus `TS_CLIENT_SECRET`, `TS_STATE_DIR`, `TS_AUTH_ONCE`, and default `TS_USERSPACE=true`. An auth key or OAuth credential must be supplied by the tailnet owner; it is not a generated initial-admin secret. `TS_AUTHKEY=file:<path>` and `TS_CLIENT_SECRET=file:<path>` are supported by [containerboot source](https://github.com/tailscale/tailscale/blob/main/cmd/containerboot/main.go), so a future adapter could mount an owner-provided mode-0600 file without placing its value in Compose or argv.
- Persist `/var/lib/tailscale` with `TS_STATE_DIR=/var/lib/tailscale` and use `TS_AUTH_ONCE=true` to retain the enrolled device identity. Decide explicitly whether the key/OAuth client creates a persistent or ephemeral node. With default userspace networking, Tailscale is a proxy for processes configured to use it, not transparent host/sibling-container routing ([userspace mode](https://tailscale.com/docs/concepts/userspace-networking)). Kernel mode requires `/dev/net/tun` and capabilities including `NET_ADMIN`; that is a separate privilege and network-design approval.
- The [v1.102.4 release](https://github.com/tailscale/tailscale/releases/tag/v1.102.4) and [container package](https://github.com/tailscale/tailscale/pkgs/container/tailscale) establish the pinned publisher/version. A deployment still needs registry digest resolution at plan time.

## Missing catalog contract

The current recipe engine creates random `privateFiles` and binds those to environment variables; it has no owner-supplied private-file input for an auth key or OAuth secret. Adding a random generated `TS_AUTHKEY` would fail enrollment. The recipe schema can describe a null published port, but it cannot declare the kernel device/capability setup needed for transparent host access. A userspace-only container without an explicit proxy/Serve target would register a device but would not fulfill the default private-ingress goal. Accordingly no recipe or setup adapter should be published until the enrollment input, exact access mode, and acceptance contract are implemented by their owners.

## Required future acceptance

After exact approval, the adapter must verify `tailscale status --json` reports `BackendState=Running` and the expected self device identity, then independently confirm that *that device* appears authorized in the intended tailnet (through a scoped admin API or owner confirmation). A trusted remote peer must reach the exact approved service over its tailnet address; an HTTP 200 from local Compose is insufficient. Restart only the owned project and verify the device ID persists and the same peer connection still works. Never infer host routing, subnet advertisement, exit-node behavior, Serve, or Funnel from a running daemon.
