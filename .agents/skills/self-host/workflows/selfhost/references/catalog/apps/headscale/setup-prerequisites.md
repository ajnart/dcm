# Headscale v0.29.4 contract

`config.ts` compiles only reviewed canonical HTTPS origin and a distinct
MagicDNS FQDN. It emits exact bytes and a deterministic service/config selection
hash. The derived adapter uses it to produce a reviewed add recipe for an
existing shared owner, not a static fresh-project recipe. It does not choose a
route or expose public ports. Config uses the existing non-secret `configFiles` / container-readable
exception: review through `generatedConfigReadability`; preserve its 0700
parent, exact bytes and 0644 mode on resume. `privateConfigs` cannot represent
this literal-only config because it requires a generated secret reference.
Do not add a dummy secret or loosen that owner boundary. Actual app-generated
Noise keys and SQLite remain in the named state volume.

The root shared owner must bind the generated recipe selection through the
central saved-recipe resolver, including exact config bytes, selected image
digest, private port and the two reviewed inputs. No separate Headscale state
file or CLI router is needed. Shared status exposes the existing
`derivedRecipe` metadata after replaying that binding and verifying retained
generated files. `setup.ts` consumes `derivedRecipe.configuration` alongside
the original declared input, exact selection fingerprint and binding hash;
missing or changed metadata stops setup. `sharedOwner: true` makes the existing
per-app route reachable after an approved derived addition. No `recipe.json`
exists. A reviewed canonical origin is configuration, not evidence that an
HTTPS route exists: API-key bootstrap uses the saved private loopback origin.

`setup.ts` verifies exact saved app/root/running status, checks key metadata is
empty, records configuration, checkpoints before the fixed owned-container
API-key create command and immediately saves validated private stdout through
`secrets.writeApiKey`. No password account, node identity or preauthkey is
created. The key is a 90-day administrative credential; expiry/rotation is
separate upkeep. Authenticated `/api/v1/apikey` readback must include the same
key prefix. Saved keys resume verification; attempted creation without a saved
key, foreign checkpoints or pre-existing unmanaged keys require reconciliation.
Loss between creation and saving is intentionally unrecoverable automatically.
Checkpoints bind both the compiler selection and immutable derived binding hash,
so a changed image/port/owner binding cannot reuse saved creation evidence.
The setup record retains null administrator username/password and pending
canonical TLS, client enrollment and restart persistence.

Sources checked 2026-10-03: pinned example config, container guide, release
`.goreleaser.yml`, CLI key/health/utils source, DB key generator, API reference
and generated Swagger (all exact links in `manifest.json`). Context7 resolve
and docs were used, but indexed `main` omits gRPC fields present in this pin;
pinned sources control this contract. The container guide warns it is
community-maintained. Release source builds the distroless image via Ko with
0.29.4 tags; guide identifies `/ko-app/headscale`, with no shell in the normal
image. No runtime UID override is made. Volume permissions and image execution
remain live checks. Metrics and gRPC stay container-loopback and unpublished;
embedded DERP/STUN are disabled. The compiler retains the documented external
Tailscale DERP map and leaves local resolver policy unchanged.

Required acceptance remains pinned config syntax/start, canonical client DNS
and TLS trust, control-protocol proxy compatibility, separately authorized
real node enrollment and peer traffic, and scoped restart persistence. CLI
health or loopback HTTP/API observations do not satisfy those checks. Only the
synthetic focused fixture is run; no Docker, browser or real secrets are read.
