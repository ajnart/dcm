# Native Homarr descriptor gaps

Checked 2026-10-03; source-only. Reused the existing pinned mapping/widget
audits, then inspected official Homarr commit
`beffe794022c22c43dd458999ee2a016bb1df2e6` from its exact Git object.
Current official docs were fetched with Context7; the pinned implementation
decides precise v2 identifiers. No live API, private trace, Docker, or CI used.

## Authentication policy

The [upstream integration definitions](https://github.com/homarr-labs/homarr/blob/beffe794022c22c43dd458999ee2a016bb1df2e6/packages/definitions/src/integration.ts)
allow both anonymous and authenticated modes for aria2, Tdarr and Pi-hole.
Our recipes instead require `rpc-secret`, `auth=true`, and a seeded Pi-hole
password respectively. Retaining `[]` as an eligible descriptor credential
set lets `homarrIntegrationCredentials` choose anonymous access when setup has
not saved the integration credential; the shared publisher then has no missing
credential to report. App-local policy must select only the authenticated
supported subset for these recipes. This audit implemented `requiredSecrets:
["apiKey"]` without anonymous alternatives for all three. No new or phantom API
key was created; missing saved credentials now remain pending.

The [aria2 adapter](https://github.com/homarr-labs/homarr/blob/beffe794022c22c43dd458999ee2a016bb1df2e6/packages/integrations/src/download-client/aria2/aria2-integration.ts)
prefixes RPC parameters with the saved `token:` secret. The
[Tdarr adapter](https://github.com/homarr-labs/homarr/blob/beffe794022c22c43dd458999ee2a016bb1df2e6/packages/integrations/src/media-transcoding/tdarr-integration.ts)
uses the saved `X-Api-Key`. Pi-hole's native field name `apiKey` is a Homarr
credential contract, not evidence that Pi-hole v6 creates a distinct durable key.

## API target eligibility — source-backed native publication guards

- The [Frigate provider](https://github.com/homarr-labs/homarr/blob/beffe794022c22c43dd458999ee2a016bb1df2e6/packages/integrations/src/stats/providers/frigate.ts)
  sends no authentication to `/api/stats`. Our safe recipe's published
  frontend is authenticated 8971; unauthenticated 5000 is container-loopback.
  Reusing the browser/frontend target cannot satisfy this native provider.
  Inventing an API key or widening the backend listener is not a descriptor fix.
- The [Caddy provider](https://github.com/homarr-labs/homarr/blob/beffe794022c22c43dd458999ee2a016bb1df2e6/packages/integrations/src/stats/providers/caddy.ts)
  requires `/reverse_proxy/upstreams` on the admin API. Our inert recipe has
  `admin off` and a readiness frontend on 2015. A target override alone is
  insufficient; enabling the management listener needs a separate exact plan.
- Tdarr has distinct Web/API port declarations, but its Web frontend may proxy
  `/api/v2/*`. The source establishes the provider's routes, not a proven
  requirement to override the target to 8266. No guessed target was installed.

After reporting this shared-owner gap, the owner assigned a narrow shared
guard. Both descriptors now declare `nativeEligibility.state: blocked`, an
exact parsed-recipe SHA-256, and a bounded explanatory requirement. The generic
mapping validator rejects malformed declarations. A changed or unknown recipe
remains blocked with `native-recipe-contract-changed`; changing a recipe does
not silently grant management authority or native compatibility.

The shared publisher still plans/applies app tiles and their managed Notebook
recap, but excludes blocked descriptors from native integration/widget writes
and functional provider queries. Direct stack-seed entrypoints also reject
blocked descriptors before any Homarr query or mutation. Reports retain the
upstream integration kind and `tileOnly: false`, expose
`pendingNativeIntegrations` and `nativeIntegrationPending`, and do not mark
native structure verified. Apply returns `attached-with-native-pending`;
read-only status remains `needs-attachment`. This is withheld native capability,
not fabricated tile-only integration success. Existing native resources are not
deleted or reconfigured. No listener, credentials, or Tdarr target changed.

## Checks and unchanged boundaries

The existing focused `homarr-catalog-mappings.test.ts` passed for 94 descriptors
(48 native). Exact identifiers, credential names and declared widget pairs
match the pinned snapshot. No unsupported resource IDs, Stats selections,
browser routes or request payloads were invented. Existing metadata/seeder
reuse remains intact. A descriptor/native inventory count is not credential,
query, widget-rendering or deployment proof. The authentication policy fixes
above are covered by the focused fixture: their authenticated subset must exist
in the independent upstream snapshot, absent keys remain missing, real saved
control credentials resolve, and username/password placeholders do not replace
the required integration credential. Native capability counts stay unchanged.

The new `homarr-native-eligibility.test.ts` passed against Bun 1.4.0. It checks
the actual recipe hashes, changed/unknown recipe refusal, direct seeder zero-call
refusal, blocked functional-query omission, and preserved tile/Notebook
structural readback with native readiness false. Caller-supplied eligibility
cannot bypass the declaration. Existing `shared-homarr-status.test.ts` passed
for normal Sonarr integration/widget readback. The affected mapping, seeder and
shared publisher bundled successfully. These synthetic checks do not prove
live dashboard rendering, app authentication, API compatibility or deployment.
