# Paperless-ngx prerequisite and Homarr descriptor

Peer slice for the Homarr coverage work, 11 October 2026. This is not complete
Homarr widget acceptance: registration and the shared compatibility/ownership
contract are blocked by #262.

## Implemented boundary

- Paperless-ngx Setup verifies the configured Admin login, then creates a
  dedicated, randomly named Homarr account. Its saved password establishes
  control before an existing account's permissions can be repaired; a rejected
  password is never reset and an unrelated account is never adopted.
- The account is active, not staff or a superuser, has no groups and has exactly
  `view_global_statistics`, `view_tag`, `view_correspondent` and
  `view_documenttype`. It cannot list document contents, upload, edit or delete
  documents. Global statistics expose archive counts; taxonomy lists retain
  Paperless's existing object-level visibility. Setup does not rewrite ownership
  or object permissions.
- `/api/token/` discovers or creates that account's reusable token. Production
  Setup never calls the rotating `generate_auth_token` endpoint. The username,
  password and verified `PAPERLESS_NGX_API_KEY` are stored through `helpers.H`
  and the existing Project secret boundary, not in command arguments.
- Every Check reads the account policy and its current token afresh, then
  authenticates against `/api/statistics/`, `/api/tags/`,
  `/api/correspondents/` and `/api/document_types/`. Missing fields are not
  accepted as zero. A null inbox count is valid when no inbox tag exists.
  Missing/stale tokens are rediscovered on `self-host setup paperless-ngx`.

## Minimal handoff to #262

`internal/apps/homarr/integration_paperless.go` proposes
`paperlessTarget() target` using only the existing `target` and `widget` types:

- Catalog ID `paperless-ngx`, upstream kind `paperlessNgx`.
- Compose-side Address `http://paperless-ngx:8000`; browser Address stays separate.
- Homarr credential `apiKey` from the peer's verified `api_key` secret.
- Native `paperlessNgx` widget showing document and inbox totals, inbox ratio,
  correspondents, tags and document types. No guessed document IDs or custom JSX.
- Registry owner explicitly adds `paperlessTarget()` after compatibility and
  conservative ownership handling are settled. No central registry, `links.go`,
  shared widget or plugin/init changes are included here.
- The supported upstream widget default is 2 by 2 cells. The central placement
  helper currently defaults unknown widgets to 1 by 1; #262's owner must preserve
  a useful size when wiring this descriptor.

The final isolated Homarr run still needs to verify useful rendered data,
stable owned IDs on rerun, token-change propagation, preservation of manual
widgets/integrations and owned-only removal. Source declarations or a passing
connection test do not satisfy that acceptance.

## Versions and sources

Paperless-ngx is pinned by this Catalog App to `3.2.1`. Its permission and
authentication contract is verified against these versioned sources:

- [REST authorization and API versioning](https://github.com/paperless-ngx/paperless-ngx/blob/v3.2.1/docs/api.md).
- [User creation and profile/token serializers](https://github.com/paperless-ngx/paperless-ngx/blob/v3.2.1/src/paperless/serialisers.py).
- [Reusable token endpoint and rotating profile endpoint](https://github.com/paperless-ngx/paperless-ngx/blob/v3.2.1/src/paperless/views.py).
- [Statistics visibility and read-only permissions](https://github.com/paperless-ngx/paperless-ngx/blob/v3.2.1/src/documents/permissions.py).
- [Statistics response](https://github.com/paperless-ngx/paperless-ngx/blob/v3.2.1/src/documents/views.py).

Homarr descriptor source contract: `2.4.1`, commit
`ebbd4876d25a51151444a009ab596e1154d62880`:

- [Authentication and all four requested data endpoints](https://github.com/homarr-labs/homarr/blob/ebbd4876d25a51151444a009ab596e1154d62880/packages/integrations/src/paperless-ngx/paperless-ngx-integration.ts).
- [Native widget options](https://github.com/homarr-labs/homarr/blob/ebbd4876d25a51151444a009ab596e1154d62880/packages/widgets/src/paperless-ngx/index.ts).
- [Native widget integration limit](https://github.com/homarr-labs/homarr/blob/ebbd4876d25a51151444a009ab596e1154d62880/packages/definitions/src/widget-integration-map.ts).
- [Native widget size](https://github.com/homarr-labs/homarr/blob/ebbd4876d25a51151444a009ab596e1154d62880/packages/definitions/src/widget.ts).

Context7 was attempted but its monthly quota was exhausted; upstream source
was used instead. No dependencies or unit-test cases were added. The existing
Paperless Setup/rerun fixture was extended to model the new API prerequisite.
