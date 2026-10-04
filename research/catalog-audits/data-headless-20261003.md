# Data/document headless audit — 2026-10-03

Source-only review of eight existing app folders. Reuses
[data-existing](data-existing.md), [Mayan EDMS](mayan-edms.md), existing
standalone routes, and their fixtures. No live project, secret/session store,
Docker deployment, restart, or Homarr publication was accessed.

## Deterministic repairs

- **Paperless:** save a syntactically valid acquired token before any fallible
  token identity/statistics request. Previously a failed readback discarded the
  response token, while its attempted checkpoint prevented acquisition replay.
  Recovery now verifies the saved token without replacing it; failed identity
  never becomes readiness. The pinned route uses
  [PaperlessObtainAuthTokenView](https://github.com/paperless-ngx/paperless-ngx/blob/v3.2.1/src/paperless/views.py)
  through [the documented token path](https://github.com/paperless-ngx/paperless-ngx/blob/v3.2.1/src/paperless/urls.py).
- **PhotoPrism:** HTTP 200 plus an `id` was not administrator proof. The pinned
  [create handler](https://github.com/photoprism/photoprism/blob/bbde8f4521771a1b1f6a258baac1fc53c8dd0227/internal/api/session_create.go)
  bypasses credentials in public mode. Require anonymous session denial, a
  successful response identifying active `admin` with the actual `admin` role,
  bounded 48-hex access token and its SHA-256 session ID, then authenticated
  session readback matching the exact user ID/UID. The transient token remains
  private and is not exported as a durable key. Sources:
  [response](https://github.com/photoprism/photoprism/blob/bbde8f4521771a1b1f6a258baac1fc53c8dd0227/internal/api/session_response.go),
  [user JSON](https://github.com/photoprism/photoprism/blob/bbde8f4521771a1b1f6a258baac1fc53c8dd0227/internal/entity/auth_user.go),
  [token/hash](https://github.com/photoprism/photoprism/blob/bbde8f4521771a1b1f6a258baac1fc53c8dd0227/pkg/rnd/auth.go),
  [readback](https://github.com/photoprism/photoprism/blob/bbde8f4521771a1b1f6a258baac1fc53c8dd0227/internal/api/session_get.go).
  Source tag `260728-bbde8f452` resolved to that exact commit; this is not image
  digest/runtime verification.
- **Syncthing:** inspection now validates exact app/status/admin-file identity
  before credential or HTTP access. First-run replay rejects another owner's
  checkpoint, an unknown stage, or a missing admin-write attempt instead of
  treating any saved key/checkpoint pair as trusted. Successful results include
  the private credential reference. These checks enforce the local shared
  setup contract; they do not prove peer synchronization.

## Per-app source and remaining acceptance

| App / pin | Source-backed bootstrap and replay boundary | Remaining evidence |
| --- | --- | --- |
| Immich v3.2.2 | [Official four-service Compose](https://github.com/immich-app/immich/blob/v3.2.2/docker/docker-compose.yml), image-default runtime, documented password-file inputs. [Admin signup/login](https://github.com/immich-app/immich/blob/v3.2.2/server/src/controllers/auth.controller.ts) is checkpointed; the scoped Homarr key is saved before readback and never recreated after uncertain creation. | Shared adapter explicitly reports `setupClosed:false`; closure needs the existing reviewed lifecycle boundary, not a guessed HTTP write. Reuse standalone photo acceptance helper when adapting shared core/restart acceptance. No fresh account/key/photo/replay/restart/Homarr check here. |
| Paperless-ngx 3.2.1 | PostgreSQL parent-directory mount, image-default startup, USERMAP_UID/GID and secret-file bootstrap remain intact. Basic verifies one active superuser; Token verifies matching UI identity/statistics. Fixed token preservation/recovery. | Synthetic fresh/recovery/lost-response checks passed. Existing trial's earlier DNS failure is not re-diagnosed or repaired here. OCR/original-byte round-trip, restart, and Homarr remain live-unverified. |
| Nextcloud 35.0.1-apache | Official image seeds admin/database through password files, web and cron share one named volume. [Pinned status](https://github.com/nextcloud/server/blob/v35.0.1/status.php) and protected OCS checks precede a checkpointed `If-None-Match:*` WebDAV PUT. Lost response resumes only exact saved-file readback. | Hidden text probe remains deliberately retained for later restart; cleanup, cron successful execution, scoped restart, restore, and actual Homarr access are separate. No recipe or adapter change. |
| Seafile 13.0.28 | [Official 13.0 Compose](https://manual.seafile.com/13.0/repo/docker/ce/seafile-server.yml) matches database/Redis topology and initial email/password inputs. Recipe disables optional services; admin-token login and an admin-only read are narrower than library function. Database/key/admin secrets use private env files, not invented `_FILE` names. | Account identity body, token lifecycle, real library upload/download/cleanup, restart and restore need live proof. `api.seafile.com` documentation fetch failed TLS hostname validation; it was not bypassed. No new route/payload or API-key claim invented. |
| Syncthing 2.1.4 | [Pinned Docker guide](https://github.com/syncthing/syncthing/blob/v2.1.4/README-Docker.md) documents PUID/PGID, persistent `/var/syncthing`, and GUI auth. Existing own-container CLI extracts the key; one-time GUI PATCH is checkpointed; Basic denial/login and key access are separate. Fixed inspection/replay owner validation. | Synthetic owner/replay negatives passed. Bridge-mode discovery differs from upstream's host-network recommendation; no host networking is granted. Exact peer/folder choices and authorized file round-trip remain required. |
| Stirling PDF 3.0.0 | Explicit `SECURITY_ENABLELOGIN=false` is the [documented no-login choice](https://docs.stirlingpdf.com/Configuration/). [Pinned embedded Dockerfile](https://github.com/Stirling-Tools/Stirling-PDF/blob/v3.0.0/docker/embedded/Dockerfile) exposes 8080, retains image startup, configs, and an inherited API-status healthcheck. No generated account/key is fabricated. | Current adapter identifies HTML only; that does not independently prove effective login policy or PDF processing. A source-backed processing round-trip and restart remain pending; no health/page-to-function promotion. |
| Mayan EDMS v4.12.2 | Refreshed [bootstrap](https://gitlab.com/mayan-edms/mayan-edms/-/raw/834ffec1b539171390358e60a0406870108514f5/mayan/apps/autoadmin/managers.py), [cleanup handler](https://gitlab.com/mayan-edms/mayan-edms/-/raw/834ffec1b539171390358e60a0406870108514f5/mayan/apps/autoadmin/handlers.py), [serializer](https://gitlab.com/mayan-edms/mayan-edms/-/raw/834ffec1b539171390358e60a0406870108514f5/mayan/apps/user_management/serializers.py), and [current-user view](https://gitlab.com/mayan-edms/mayan-edms/-/raw/834ffec1b539171390358e60a0406870108514f5/mayan/apps/user_management/api_views.py). Current-user uses UserSerializer, so same-password cleanup is not the restricted admin-detail password endpoint. Saved-token-before-readback already correct. | Serializer exposes no staff/superuser flag. Existing result honestly retains `administratorAuthority:not-verified`; user-view permission is not superuser proof. Document processing, restart, actual private-config readability, and restore remain pending. Existing Mayan fixture evidence reused, not rerun. |
| PhotoPrism 260728 | SQLite, writable originals/storage, private admin env bootstrap and image-default runtime remain unchanged. Repaired exact role/identity proof against the resolved publisher source tag. | Synthetic login/readback/replay and public/wrong-role/identity negatives passed. Photo ingestion/indexing/original readback, restart, restore and fresh image behavior remain live-unverified. |

## Focused validation

`packages/cli/tests/data-headless-setup.test.ts` passed with Bun 1.4.0:
Paperless token preservation before interrupted verification, saved-token
recovery, no reacquisition after a lost token response, wrong token identity;
PhotoPrism repeated login/readback, malformed token/session, wrong name/role,
disabled login, public mode, readback mismatch/401, wrong saved owner;
Syncthing inspection/replay and cross-owner/app rejection. Outputs contain no
credentials or session tokens. HTTP/application responses are synthetic, not
fresh image execution or live acceptance.

Focused Bun builds passed for the three changed adapters and new fixture.
Direct `validateAppRecipe` checks passed for exactly these eight app recipes;
the full catalog/test suite was not run. No shared engine/transport edit,
dashboard mapping change, CI, commit, or deployment.
