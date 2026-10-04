# Existing local tunnel provider reads

`cloudflarePrestartProviderReview` consumes the shared owner's no-argument
`readCloudflareProvider` facility. It never accepts a caller API response.
The producer permits only fixed HTTPS GETs at `api.cloudflare.com/client/v4`;
it refuses redirects, bounds headers/body/time/pagination, revalidates the
actual shared owner and saved private bytes around every GET, and mints a
30-second in-process observation. JSON copies are not observations.

The exact owner directory supplies `cloudflare-provider-scope.json` (0600),
bound to `ownerManifestHash`, account/tunnel/zone/Access IDs, one hostname,
the account/DNS/TLS/authentication owners, and the imported credential digest.
Its `readApproval` is the `CLOUDFLARE-READ` digest of that exact scope. The
credential has the fixed private-file ID `provider-api-token`, under
`secrets/cloudflare-tunnel`; use the existing owner-file importer, not argv,
generated random credentials or an arbitrary input path. The read credential
is distinct from the tunnel enrollment credential. Read approval authorizes
only inspection, not public exposure or credential consumption by a container.

Readbacks cover account, tunnel identity/config source, scoped private IP and
hostname routes, exact Access application and its policies, zone/account,
exact-host DNS, SSL setting and certificate packs. The local branch requires
`config_src=local`, no private routes, one proxied CNAME to the selected tunnel,
an exact self-hosted Access hostname with no bypass/non-identity policy, and
an active unexpired covering provider certificate. This does not prove live
client DNS/TLS or enforcement. Unknown/incomplete pagination fails closed;
large inventories need a separate reviewed bounded strategy.

## Consumed shared recipe

The derived recipe requires `target-app-id`, `hostname` and `tunnel-id`. It
allows only the reviewed application frontend profiles in `configuration.ts`,
not administration, identity, downloader or Homarr native MCP exposure. Local
config selects exactly that frontend and hostname, disables WARP routing and
ends with `http_status:404`. No provider resources are created or changed.

Import `tunnel-credentials` and `provider-api-token` through the existing shared
owner-file input before Docker. The account read token remains an owner-only
pre-start consumer; it is neither mounted nor injected. The official local JSON
contains exactly `AccountTag`, `TunnelSecret`, `TunnelID` and `Endpoint` (empty).
The documented `TUNNEL_CRED_CONTENTS` input uses a reviewed `owner-json`
environment binding: a declared string-field object, bounded literal-safe
serialization into mode-0600 env state, verified against the imported bytes
before activation. Docker operators and container processes can inspect this
environment credential. The image retains its nonroot UID/GID 65532; no private
credential bind, chmod/chown or undocumented numeric-user override is needed.
The non-secret exact config is read-only, mode0644 beneath the owner0700 parent.

For the prepared shared owner, pass `--app cloudflare-tunnel` and its exact root
and ID to these separately approved commands:

- `app shared cloudflare-read-plan --authority-input /exact/private/scope.json`
- `app shared cloudflare-read-apply --authority-input /exact/private/scope.json --approve CLOUDFLARE-READ:...`
- `app shared cloudflare-public-plan`
- `app shared cloudflare-public-apply --approve CLOUDFLARE-PUBLIC:...`

Scope choices are an owner0600 non-secret JSON object containing account/tunnel/
zone/Access IDs, hostname and account/DNS/TLS/authentication owners. Credential
digests come only from the actual imported files. Read approval authorizes only
fixed GET inspection. Public approval binds the actual immutable derived recipe,
same-owner origin, local config, imported credential/env bytes, provider identity,
route inventories, Access policy, DNS and TLS readbacks. Every startup reruns
these observations and compares retained public consent. No caller boolean is
authority. Scope/public files are immutable; changed manifest/authority requires
a separately reviewed replacement workflow, not silent overwrite.

Native `cloudflared tunnel --metrics 127.0.0.1:2000 ready` checks only the private
edge connection. Intended client DNS/TLS, Access allow/deny and application
delivery remain acceptance obligations. Provider snapshots do not freeze later
provider changes or prove client enforcement. No live provider or deployment
verification was performed for this source change.

Publisher credential environment source:
https://github.com/cloudflare/cloudflared/blob/2026.9.1/cmd/cloudflared/tunnel/subcommand_context.go

Sources checked 2026-10-03 through Context7 and official API documentation:

- https://developers.cloudflare.com/api/resources/zero_trust/subresources/tunnels/subresources/cloudflared/methods/get/
- https://developers.cloudflare.com/api/resources/zero_trust/subresources/networks/subresources/routes/methods/list/
- https://developers.cloudflare.com/api/resources/zero_trust/subresources/networks/subresources/hostname_routes/methods/list/
- https://developers.cloudflare.com/api/resources/zero_trust/subresources/access/subresources/applications/subresources/policies/methods/list/
- https://developers.cloudflare.com/api/resources/dns/subresources/records/methods/list/
- https://developers.cloudflare.com/api/resources/ssl/subresources/certificate_packs/methods/list/
