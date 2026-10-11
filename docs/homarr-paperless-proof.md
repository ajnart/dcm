# Paperless-ngx prerequisite and Homarr descriptor

Peer slice for #289, 11 October 2026. This is not complete
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

## Isolated prerequisite evidence

Validated implementation commit: `368cc026` on `feat/homarr-paperless-sol`.
The only runtime fixture used Compose Project
`self-host-paperless-sol-93543`, loopback port `53415`, and one new disposable
Home under the approved OpenCode temporary directory. No existing Project,
private documents, browser profiles or credential stores were inspected.
Development Telemetry and update checks were disabled. The three containers
were limited to 2304 MiB total and two CPUs each, with an eight-minute deadline.
Only the existing production service/helper/Project boundaries performed
installation, Setup, credential persistence and Compose commands; the fixture
wrapper changed resource limits only.

Observed results:

- Fresh installation with Admin login `fixture-admin` passed Setup and Check,
  including credential creation and fresh authenticated probes on an empty
  archive. The prior hard-coded administrator lookup was corrected.
- A single synthetic document model, owned by the fixture administrator, with
  an unowned inbox tag, correspondent and document type returned
  `documents_total=1`, `documents_inbox=1` using the read-only token. All three
  taxonomy endpoints passed Check. This proves document-count access, not OCR,
  ingestion, physical document downloads or Homarr rendering.
- The same token received HTTP 403 for taxonomy writes and document-content
  listing. Account policy checks confirmed the exact four permissions, no
  groups and no staff/superuser status.
- A valid Setup rerun kept the token unchanged. Replacing the saved key with
  an invalid synthetic value made fresh Check fail; Setup rediscovered the same
  upstream token without rotation.
- A controlled upstream token rotation in the fixture made Check fail again;
  Setup rediscovered that new token without rotating it a second time.
- Exact App response: Paperless-ngx `3.2.1`, API version `10`.
  Image: `ghcr.io/paperless-ngx/paperless-ngx@sha256:5fa76604a81df6945086e0837b14b56543d137e8ce4f311cc5d9ebe907e74e79`.
  The fixture also used the Catalog's `postgres:18` and `valkey/valkey:9-alpine`.
- Initial synthetic seeding needed the App key and database password passed
  through the helper's environment because container exec bypasses entrypoint
  `_FILE` resolution. The same fixture was resumed after that harness-only
  correction; no second fixture was created. Its exact owned Compose Project
  was taken down after each run, and a label-filtered check confirmed no owned
  containers remained. Synthetic files were retained only in that disposable
  Home; no broad prune or volume deletion occurred.

Local gate passed: empty `gofmt -l .`, `go build ./...`, `go vet ./...`,
`go vet -tags e2e ./e2e/`, `go test ./...`, race checks for
`internal/tui`, `internal/activity`, `internal/apps/paperlessngx` and
`internal/apps/homarr`, and `bash -n install.sh`. No e2e runtime suite or
installer was run. The first combined gate command hit its shell deadline
after the full test suite passed; the remaining race and shell checks passed
in a separate bounded command.

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
