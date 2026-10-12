# Paperless-ngx prerequisite and Homarr descriptor

Peer slice for #289. The prerequisite runtime evidence below belongs to
11 October 2026 and implementation commit `368cc026`; the source-only ownership
and Manual recovery follow-up is dated 12 October 2026. Neither is complete
Homarr widget acceptance. #262's shared contract is now frozen at
`6b82c55fb890c11a1388bd4e5a2f10b632ff4f7c`; central wiring and new bounded
native/rendered/lifecycle acceptance remain held.

## Implemented boundary

- Paperless-ngx Setup verifies the configured Admin login, then creates a
  dedicated, randomly named Homarr account only when no account checkpoint,
  username, password or token is saved. A pending checkpoint precedes the
  remote write; the verified create response supplies its canonical account ID.
  A random ownership marker is recorded with that ID and in the dedicated
  account's First name field. Neither the shared Admin login nor another
  account's metadata is modified.
- The account is active, not staff or a superuser, has no groups and has exactly
  `view_global_statistics`, `view_tag`, `view_correspondent` and
  `view_documenttype`. It cannot list document contents, upload, edit or delete
  documents. Global statistics expose archive counts; taxonomy lists retain
  Paperless's existing object-level visibility. Setup does not rewrite ownership
  or object permissions.
- Reruns resolve only `/api/users/<recorded-id>/`, require that returned ID and
  ownership marker to agree, and authenticate the saved password using the
  returned canonical username. The Basic-auth and token-auth profiles must
  carry the same marker. A profile alone returns no ID: marker correlation
  with the exact administrator-authenticated detail record is the identity
  evidence, not arbitrary token success or a username lookup.
- The current profile token is reused. `/api/token/` creates a reusable token
  only when that verified profile has none. Production Setup never calls the
  rotating `generate_auth_token` endpoint. The checkpoint, username, password
  and verified `PAPERLESS_NGX_API_KEY` are stored through `helpers.H` and the
  existing Project secret boundary, not in command arguments.
- Every Check reads account policy, ownership and current token afresh, then
  authenticates against `/api/statistics/`, `/api/tags/`,
  `/api/correspondents/` and `/api/document_types/`. Missing fields are not
  accepted as zero. A null inbox count is valid when no inbox tag exists.
  Missing/stale tokens are rediscovered on `self-host setup paperless-ngx`.

## Source-only ownership and Manual recovery follow-up

This follow-up changes only Paperless Setup/token code, its existing fixture
bodies, this proof and the App trap notes. No new test functions, cases,
dependencies, runtime, registry edits or shared verifier changes were added.

- A renamed selected account or lost saved username keeps the same recorded
  ID, ownership marker, password and reusable token. The current canonical
  username is saved only after authenticated ownership and data checks pass.
- Legacy name-only metadata cannot establish canonical provenance. It remains
  Manual without adopting an existing account, adding an ownership marker,
  replacing a token or rewriting permissions. Malformed/missing/pending
  checkpoints likewise fail closed. A failed final checkpoint write cannot
  cause a second account/token on retry.
- Verified credential denial, disabled status, MFA, identity disagreement and
  policy drift are targeted retryable Manual steps. Setup never reactivates
  users, disables MFA, resets passwords, changes existing permissions, rotates
  tokens or deletes accounts. Infrastructure failures and malformed API/data
  responses remain failed steps; they are not blanket-converted to Manual.
- The supported person recovery seam is the official 3.2.1 Users & Groups →
  Edit user dialog: it displays the ID and exposes Password, First name and
  Active controls. After confirming the recorded ID/marker privately with
  `self-host credentials`, the person may restore the corresponding saved
  password or Active status if intended, then retry Setup. MFA remains a
  separate person decision; Setup does not clear it. The restored known pair
  reuses its existing token. No account UI action was performed for this fix.
- Missing saved credentials or unverifiable old ownership require a verified
  Project Backup or separately approved migration. This slice adds no private
  Inputs, no `--set-file` ingestion and no credentials-only update command.
  It does not claim an automatic old-format migration or a general replacement
  credential recovery route.

Direct controls were added to the existing Setup/rerun fixture bodies for
returned ID/marker persistence, renames, lost usernames, stale keys, legacy
and wrong-ID/marker uncertainty, different authenticated owners, changed or
missing passwords, disabled status, MFA, permission drift, partial checkpoint
writes, profile denial versus HTTP 503, malformed account/profile/count fields,
and successful recovery after restoring the same known account controls.
They assert one account/token, no other remote account mutations and unchanged
Admin credentials. These are synthetic HTTP/secret-store controls, not new
native runtime or rendered acceptance evidence.

The source-only local gate passed on 12 October: focused
`go test ./internal/apps/paperlessngx/`, empty `gofmt -l .`, `go build ./...`,
`go vet ./...`, `go vet -tags e2e ./e2e/`, `go test ./...`,
`go test -race ./internal/tui/ ./internal/activity/ ./internal/apps/paperlessngx/`,
`bash -n install.sh` and `git diff --check`, with `GOFLAGS=-buildvcs=false`.
No Docker, browser, e2e runtime, installer, host probes or account actions ran.

## Homarr wiring handoff

`internal/apps/homarr/integration_paperless.go` proposes
`paperlessTarget() target` using only the existing `target` and `widget` types:

- Catalog ID `paperless-ngx`, upstream kind `paperlessNgx`.
- Compose-side Address `http://paperless-ngx:8000`; browser Address stays separate.
- Homarr credential `apiKey` from the peer's verified `api_key` secret.
- Native `paperlessNgx` widget showing document and inbox totals, inbox ratio,
  correspondents, tags and document types. No guessed document IDs or custom JSX.
- Registry owner explicitly ports/registers `paperlessTarget()` against the
  frozen contract. No central registry, `links.go`,
  shared widget or plugin/init changes are included here.
- The supported upstream widget default is 2 by 2 cells. The central placement
  helper on this branch defaults unknown widgets to 1 by 1; the registry owner
  must preserve a useful size when wiring this descriptor.

The final isolated Homarr run still needs to verify useful rendered data,
stable owned IDs on rerun, token-change propagation, preservation of manual
widgets/integrations and owned-only removal. Source declarations or a passing
connection test do not satisfy that acceptance.

## Isolated prerequisite evidence

Historical validated implementation commit: `368cc026` on
`feat/homarr-paperless-sol`. This run predates the canonical ID/marker and
Manual recovery changes; it does not validate those changes at runtime.
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
- [Basic authentication and MFA boundary](https://github.com/paperless-ngx/paperless-ngx/blob/v3.2.1/src/paperless/auth.py).
- [Official Edit user ID/password/status controls](https://github.com/paperless-ngx/paperless-ngx/blob/v3.2.1/src-ui/src/app/components/common/edit-dialog/user-edit-dialog/user-edit-dialog.component.html).
- [Person-controlled MFA recovery](https://github.com/paperless-ngx/paperless-ngx/blob/v3.2.1/docs/usage.md#two-factor-authentication).
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
