# Paperless-ngx API acceptance, v3.2.1

The bundled recipe pins `ghcr.io/paperless-ngx/paperless-ngx:3.2.1`. These are
version-pinned API facts, not live acceptance evidence.

- [API docs](https://github.com/paperless-ngx/paperless-ngx/blob/v3.2.1/docs/api.md):
  HTTP Basic auth accepts `username:password`; token acquisition is optional.
  Multipart `POST /api/documents/post_document/` uses a `document` part and
  returns a task UUID before consumption completes. Poll
  `GET /api/tasks/?task_id=<uuid>` before claiming a document exists.
- [Pinned URL map](https://github.com/paperless-ngx/paperless-ngx/blob/v3.2.1/src/paperless/urls.py)
  routes `/api/token/` to `PaperlessObtainAuthTokenView`, which inherits Django
  REST Framework's obtain-token POST. The pinned
  [Paperless view](https://github.com/paperless-ngx/paperless-ngx/blob/v3.2.1/src/paperless/views.py)
  does not override that POST; Paperless requires DRF `~=3.16`, whose
  [implementation](https://github.com/encode/django-rest-framework/blob/3.16.1/rest_framework/authtoken/views.py)
  uses `Token.objects.get_or_create(user=user)`. Repeating `/api/token/` with
  the same valid account therefore returns the existing token, rather than
  rotating it. Do not substitute `/api/profile/generate_auth_token/`: the
  pinned Paperless view deletes any old token before creating a new one.
- `app paperless-token-plan` verifies the exact saved, applied/running recipe and
  generated admin password through the private API; `paperless-token-create`
  needs its fresh exact approval. When no token file exists, it POSTs credentials
  only in the request body, verifies the returned token against
  `/api/statistics/`, then saves a 0600 owner-only token file without
  overwriting a different existing token. An existing valid token file is a
  read-only replay: no POST or rotation. `paperless-token-status` rechecks the
  private token without a POST. Default `app handoff` reports only the path;
  explicitly requested `app handoff --show` includes `PAPERLESS_NGX_API_KEY`
  in its secrets-full export after checking the saved file's mode and token
  format. Ordinary status, logs, and handoff output never contain the token.
  This is a credential
  and statistics-API checkpoint, not Homarr attachment, document/OCR acceptance,
  restart persistence, or browser proof. A fresh live Paperless v3.2.1 run must
  prove endpoint behavior, token readback, and service permissions; pinned source
  alone cannot prove the deployed image or current service state.
- [Docker setup](https://github.com/paperless-ngx/paperless-ngx/blob/v3.2.1/docs/setup.md)
  documents the general `_FILE` configuration suffix for Docker secrets. It
  covers the recipe's admin password, database password, and secret key files;
  do not assume the same suffix works in bare-metal `paperless.conf` setups.
- [User API](https://github.com/paperless-ngx/paperless-ngx/blob/v3.2.1/src/paperless/views.py)
  and [serializers](https://github.com/paperless-ngx/paperless-ngx/blob/v3.2.1/src/paperless/serialisers.py):
  `/api/users/` is authenticated and paginated; its user records expose
  `username`, `is_active`, and `is_superuser`. The first CLI increment verifies
  the managed password and exact admin user with this read-only endpoint.
- [Task API implementation](https://github.com/paperless-ngx/paperless-ngx/blob/v3.2.1/src/documents/views.py)
  and [task serializers](https://github.com/paperless-ngx/paperless-ngx/blob/v3.2.1/src/documents/serialisers.py):
  API v10 task lists are paginated and a successful ingestion task carries
  `result_data.document_id`. Handle a saved task UUID on retry rather than
  uploading another test document after an uncertain result.
- [Document API implementation](https://github.com/paperless-ngx/paperless-ngx/blob/v3.2.1/src/documents/views.py):
  `GET /api/documents/<id>/download/?original=true` selects source bytes rather
  than an archive rendition. A document's `content` is the extraction/OCR text.
  To prove OCR, upload an image-only document with an exact visible phrase;
  a text PDF would prove extraction, not OCR. The CLI embeds one harmless PNG
  that visibly reads `SELFHOST OCR CHECK`, then requires that phrase in API
  `content` and an exact SHA-256 match for the downloaded original.
- [Usage guide](https://github.com/paperless-ngx/paperless-ngx/blob/v3.2.1/docs/usage.md):
  deletion moves documents to recoverable trash. A safe canary can stay in the
  library across a separately approved stop/start and then move to trash.

The deterministic upload/task/OCR/original-byte path and separately approved
stop/start readback and separately approved recoverable-trash cleanup are
implemented but have not passed a live Paperless trial.
A response lost before the task UUID is saved requires manual inspection rather
than a blind second upload. Cleanup checks the saved document title and original
bytes before DELETE, then reads it from `/api/trash/`; retries inspect trash
before any delete. Remaining work: an isolated live Paperless trial. The login
check alone satisfies none of these.

Pinned `TrashView` returns paginated, full `DocumentSerializer` records; it has
no ID or field projection filter. Cleanup scans at most 50 five-document pages,
with an 8 MiB per-page cap. A larger or OCR-heavy trash history fails closed
and requires manual inspection, rather than guessing that the canary is absent.
