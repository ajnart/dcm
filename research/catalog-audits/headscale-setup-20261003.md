# Headscale shared first-run seam — 2026-10-03

Scope: existing reviewed derived-add route, pinned Headscale v0.29.4, shared
per-app setup. No second router, static fresh-project recipe, Docker execution,
real credentials, CI or live acceptance.

## Producer and consumer

`shared-unit-setup.ts` already projects `derivedRecipe` after loading the saved
binding: `appId`, `input`, `configuration`, `sourceSha256`, `recipeSha256`,
`selectionFingerprint`, `bindingHash`. The old Headscale consumer instead read
the proposed, never emitted `headscaleConfig` field and declared
`sharedOwner: false`. This made its existing researched adapter unreachable.

Headscale now consumes that shared shape. It checks the app/input identities,
the selection fingerprint against shared status, declared canonical-origin and
MagicDNS inputs, and every deterministic compiled configuration field. Setup
checkpoints additionally retain the immutable derived binding hash. The shared
owner remains responsible for replaying source/selection/owner bindings and
checking exact retained generated-file bytes and modes before setup status.
That file verification is a shared integration prerequisite, not a new
Headscale-specific status projection.

Root reconciliation closes that source-level seam: shared status calls the
common read-only generated-config verifier before projecting the derived
binding, and emits `configurationFilesVerified: true` only afterward. The
adapter requires that marker. Preparation and inspection reuse one byte/mode
checker. The focused filesystem fixture rejects missing/changed files,
symlinks, extra hard links, and widened directory/file permissions without
repairing them. This does not attest a real Headscale process or TLS route.

The canonical HTTPS origin configures `server_url`; it does not approve or
prove working ingress. The admin bootstrap/readback stays on the exact saved
loopback origin. Metrics/gRPC remain container-loopback, DERP/STUN disabled,
and state persists in the selected named volume. No user, password account,
node or preauthkey is created. Results expose only a private API-key reference,
null administrator username/password and pending TLS/enrollment/restart claims.

## Versioned upstream proof

Context7 was resolved with `npx ctx7@latest library Headscale`, then queried at
`/juanfont/headscale` for configuration and API-key CLI semantics. The index
returned `main`, not a v0.29.4 version ID; notably its gRPC configuration differs.
Exact pinned sources therefore control the implementation:

- [Pinned config](https://raw.githubusercontent.com/juanfont/headscale/v0.29.4/config-example.yaml):
  `/etc/headscale/config.yaml` lookup, server/listener separation, private gRPC,
  persistent Noise/SQLite paths and distinct MagicDNS domain.
- [Pinned API-key CLI](https://raw.githubusercontent.com/juanfont/headscale/v0.29.4/cmd/headscale/cli/api_key.go):
  `apikeys list`, `apikeys create --expiration 90d`, metadata list and one-time key output.
- [Pinned CLI transport/output](https://raw.githubusercontent.com/juanfont/headscale/v0.29.4/cmd/headscale/cli/utils.go):
  local Unix socket without a remote API credential; JSON list serialization;
  default create output prints the complete key followed by a newline.
- [Pinned key generator](https://raw.githubusercontent.com/juanfont/headscale/v0.29.4/hscontrol/db/api_key.go):
  `hskey-api-`, a 12-character URL-safe prefix and 64-character URL-safe secret;
  only the secret hash is retained upstream. Creation without captured output
  cannot be reconciled by listing credentials and must never auto-replay.
- [Pinned API schema](https://raw.githubusercontent.com/juanfont/headscale/v0.29.4/gen/openapiv2/headscale/v1/headscale.swagger.json):
  authenticated GET `/api/v1/apikey` returns `apiKeys` containing `prefix`.
- [Pinned metadata conversion](https://raw.githubusercontent.com/juanfont/headscale/v0.29.4/hscontrol/types/api_key.go):
  the API response prefix is masked as `hskey-api-<12-character-prefix>-***`,
  not the raw database prefix. The old raw-prefix comparison would always fail
  against this pin. Adapter and fixture now require the exact masked identity.
- [Pinned container guide](https://raw.githubusercontent.com/juanfont/headscale/v0.29.4/docs/setup/install/container.md):
  read-only image, writable socket tmpfs, persisted state and config mount;
  distroless image has no shell, binary location is `/ko-app/headscale`.
  This guide explicitly warns it is community-maintained, not developer-verified.

The adapter persists the attempted checkpoint before the write, captures and
saves the key before authenticated readback, reuses saved keys only with matching
creation evidence, and stops after ambiguous creation/capture loss. A failed
readback may retry verification, never key creation.

## Focused validation

Bun 1.4.0 at
`/tmp/bunx-1000-bun@1.4.0/node_modules/@oven/bun-linux-x64/bin/bun`:

- `packages/cli/tests/headscale-contract.test.ts`: pass. Existing fixture now
  follows the real producer shape; checks null account identity, capture before
  readback, saved-key resume, lost-output no-replay, unmanaged keys, changed
  config bytes/inputs/selection and a changed binding on first-run/inspection.
  It also rejects a raw, unmasked prefix instead of upstream's metadata format.
- `bun build .../apps/headscale/setup.ts --target=bun --outfile=/dev/null`: pass.
- `git diff --check`: pass at validation time.

These are synthetic contract checks, not Docker/image execution. Pinned config
syntax/start, retained-file shared integration, canonical DNS/TLS trust, reverse
proxy control-protocol support, authorized real-client enrollment/peer traffic
and scoped restart persistence require separate evidence. No live first-run or
application acceptance is claimed.
