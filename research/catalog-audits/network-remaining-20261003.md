# Remaining network apps: exact shared-contract gaps

Checked 2026-10-03 against the same-day pinned primary evidence in
[`compose-catalog-network-20261003.md`](../compose-catalog-network-20261003.md)
and [`network-missing.md`](network-missing.md). HAProxy's 3.2.25 manual and
pinned Dockerfile were refreshed; Context7 `library` then `docs` supplied DNS
resolver examples. Headscale/Pangolin pins reuse same-day research, without a
fresh version lookup. No Docker, pulls, secret/session reads, public ingress,
enrollment, privilege grants, CI, commits or live acceptance.

No recipe/setup was added for HAProxy, Headscale or Pangolin. Shared HTTPS
provides localhost-only Caddy routes and private CA transport, not application
canonical-origin config transitions. Approved TLS alone cannot make these
configurations valid.

## Implemented reusable target seam

`packages/cli/src/lib/shared-service-target.ts` exports
`resolveSharedServiceTarget(state, targetAppId)`. It takes the exact loaded
`SharedProjectState`, validates completed record/manifest hashes using the
existing shared-private-HTTPS model, and selects only the named app's primary
frontend. It rejects arbitrary URLs/helper services, ambiguous ports, unpinned
images, wildcard/public bindings, database purposes and external network owners.
It returns Docker hostname, target/published ports, pinned image, exact front
bridge and canonical owner/target fingerprints for proxy/Serve consumers to
bind into their approval. It performs no I/O or mutation. The front bridge is
currently `internal: false`; same-owner/private loopback publication is not
proof of bridge isolation or runtime reachability. Root owns consumer wiring;
no deployable HAProxy recipe is claimed by this helper.

## Remaining reusable seams

These are proposals, not executable routes or mutation authority. They belong
in common recipe/config/transport owners, not a new app CLI command router.

| App | Exact contract still needed | First-run boundary |
| --- | --- | --- |
| HAProxy 3.2.25 | Bind explicit same-owner target into generated config/approval; deliver reviewed non-secret config readable by UID/GID 99. Identity owner separately adds publisher-backed `readability: container` config under an owner-only parent, leaving default/private files 0600. | Validate rendered syntax and route real backend traffic. No first-admin account/API key exists to invent. |
| Headscale v0.29.4 | Recipe-owned config bound to canonical HTTPS origin and distinct MagicDNS domain, exact byte hashes and resume checks. | Create one administrative API key, save privately and prove authenticated API readback. Node identities/preauthkeys are not password/admin accounts. |
| Pangolin 1.24.0 | Reviewed no-tunneling mode, selected dashboard/base domain and HTTPS/CORS origin, private server secret and pinned fresh-start bootstrap-token capture. | Inspect fresh state, create one owner, verify owner/organization/session. Full Gerbil mode needs separate privilege/network approval. |

The minimal config seam is finite recipe-declared parts: literal text,
`canonical-origin`, `hostname`, explicit same-owner target and reviewed app
inputs (such as `magic-dns-domain`). No arbitrary interpolation/shell expression.
Hash the selected origin, target, input values, template and exact bytes into
the selection. Resume accepts retained bytes or separately approved exact next
revision; third-party edits fail closed. Secrets remain 0600; explicit
non-secret container-readable files need publisher evidence and an owner-only
parent. The HTTPS owner supplies persisted route URL, not proof of intended
client DNS/trust, protocol compatibility or application acceptance.

Headscale can reuse fixed `container.exec` and `secrets.writeApiKey`: checkpoint
before key creation, validate private stdout, save immediately, then authenticated
readback. No replay after attempted creation without a saved key. The create-to-save
crash window requires operator reconciliation; listing returns only metadata.
Never overload `captureAdminPassword`. Pangolin needs its own pinned current-start
log-token recognizer, not qBittorrent's password reader. The documented plaintext
password-argv CLI is not a private password transport.

## Primary evidence

- HAProxy [3.2.25 manual](https://docs.haproxy.org/3.2/configuration.html),
  [publisher Dockerfile](https://raw.githubusercontent.com/docker-library/haproxy/60e87b92f7a36f502cd71911c9a6c39220ba1424/3.2/Dockerfile)
  and [image guide](https://raw.githubusercontent.com/docker-library/docs/master/haproxy/README.md):
  supplied config, UID/GID 99, runtime DNS resolution. Future backend config can
  use an exact Docker-DNS target with a resolver and `init-addr none`; an inert
  readiness frontend is not configured load balancing.
- Headscale [version-matched config](https://raw.githubusercontent.com/juanfont/headscale/v0.29.4/config-example.yaml),
  [container example](https://raw.githubusercontent.com/juanfont/headscale/v0.29.4/docs/setup/install/container.md)
  and [API-key source](https://raw.githubusercontent.com/juanfont/headscale/v0.29.4/cmd/headscale/cli/api_key.go):
  selected server URL, persistent state and one-time key output. Enrollment,
  protocol proxying, mesh traffic and restart recovery remain live proof.
- Pangolin [Compose template](https://raw.githubusercontent.com/fosrl/pangolin/1.24.0/install/config/docker-compose.yml),
  [config template](https://raw.githubusercontent.com/fosrl/pangolin/1.24.0/install/config/config.yml),
  [manual setup](https://docs.pangolin.net/self-host/manual/docker-compose)
  and [container CLI](https://docs.pangolin.net/self-host/advanced/container-cli-tool):
  domain/secret config, first-boot token and privileged tunnels. No-tunneling is
  not outbound tunnel acceptance.

## Focused validation

`packages/cli/tests/network-remaining-setup.test.ts` exercises target determinism,
non-mutation, pinned identity, hash changes/corruption, missing units, helper
selection, network ownership, ambiguous ports and private-authority restrictions.
It does not assert missing recipes. The focused pure fixture and helper Bun
build pass. No provisioning, HAProxy syntax execution, live routing or first-run
acceptance was attempted.
