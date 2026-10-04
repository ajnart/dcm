# Shared private HTTPS primitive — 2026-10-03

Implemented source primitives; no deployment or live acceptance.

- `shared-private-https-state.ts` retains one immutable hash-bound review binding
  at the exact shared owner's `private-https-binding.json` (0600). It reruns the
  pure route planner with the canonical recipe hash, pinned image, saved source
  and observation; reconstruction accepts only the matching installed Caddy
  fingerprint/service, project/settings, frontend services/units and front
  networks. Retained source services are never promoted into desired state.
- `shared-private-https-apply.ts` separately approves only CA export and TLS
  probes after the same saved owner is completed. It validates the latest owner,
  persisted binding, generated Caddyfile bytes and canonical Compose file, then
  reads only `/data/caddy/pki/authorities/local/root.crt` through exact
  context/project/file `compose exec -T caddy`. It validates a current self-signed
  X509 CA, exports an exact no-clobber 0600 root, and uses `curl --disable
  --cacert --resolve --noproxy` for each localhost route. No insecure fallback,
  Docker add/recreate, global trust-store change, DNS write or public exposure.
- A failed/interrupted proof may repeat exact export/probes. Different retained
  CA bytes, malformed/truncated artifacts, uncertain Compose checkpoints, recipe
  drift and config drift fail closed and require inspection. No stale lock or
  artifact is removed automatically.

## Remaining orchestration and acceptance boundaries

The caller must use the existing per-owner lock, review an exact Caddy-only
`addSelected` approval, save the binding before mutation, prepare the deterministic
selection, persist reviewed/attempted/completed owner checkpoints and preserve
retained-service observations. An uncertain add is not replayed by transport
verification. The primitive does not add a fake `https-apply` path.

Saved-selection reconstruction must load the binding for generated Caddy rather
than use the catalog's inert readiness recipe; use the returned selection verbatim
(adding an empty `hostPaths` object changes selection identity). Exact
state/config and Docker lifecycle remain the existing owners' responsibility.

Current scope is host-only `*.localhost`; LAN DNS and eligible cookie domains
(Authelia), app canonical-origin/proxy config, transport consumption by setup
adapters, Homarr client-facing links, intended-client CA trust and app/restart
acceptance remain separate required seams. App frontend environment/config
transitions deliberately invalidate the original route binding; supporting them
requires an explicit reviewed binding-revision/rebase contract, not weaker
service comparisons. A TLS-valid HTTP 502 is transport proof only.

## Primary documentation and focused evidence

Context7 refreshed `/caddyserver/website` (library then docs). Caddy's
[running documentation](https://caddyserver.com/docs/running) specifies the
container CA root path; [automatic HTTPS](https://caddyserver.com/docs/automatic-https)
describes persistent local CA state and separate client trust. The implementation
does not execute the documented system-wide trust-store installation.

The single new `shared-private-https-apply.test.ts` fixture passes using Bun 1.4.0,
synthetic Compose observations, injected command outcomes and a public test root.
It checks deterministic reconstruction, exact target commands, private artifacts,
approval/drift rejection, repeated proof, failed TLS and narrow HTTP-status
semantics. Docker, real Caddy certificates, browser DNS/trust, app login and
restart behavior were not exercised.
