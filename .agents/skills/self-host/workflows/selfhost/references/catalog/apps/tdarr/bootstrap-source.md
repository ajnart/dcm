# Tdarr 2.92.01 bootstrap evidence

Read-only source inspection on 2026-09-30; no server execution or live acceptance.

- Image: `ghcr.io/haveagitgat/tdarr:2.92.01`, amd64 manifest
  `sha256:a99cbe9a03ff6471fe45651302a947d884235002c9e17eb2f52223978e07897a`.
- Image config: `sha256:844e1c4fc2b37449104b89dadb8a6879142d934c36d78c7382f5d59e4768e10d`.
  Its build history records `VERSION=2.92.01`,
  `DATE=2026_09_29T04_50_21z`, `USE_PROD_PACKAGES=false`, and the archive base
  `https://storage.tdarr.io/dev/versions/$VERSION`.
- Exact [official release archive](https://storage.tdarr.io/dev/versions/2.92.01/linux_x64/Tdarr_Server_2026_09_29T04_50_21z.zip):
  251318409 bytes; ETag `c87ecfec263c6b34e644c0145438f673`.
  HTTP range reads inspected its ZIP directory and inflated only
  `public/static/js/main.affbd14c.js` (compressed offset 101508315,
  compressed size 1544905). No downloaded application was executed.

Exact frontend contracts:

- `authRegister`: POST `/api/v2/public/auth/register`, `{username,password}`;
  UI accepts status 201 and reads `response.data.token`.
- `authLogin`: POST `/api/v2/public/auth/login`, `{username,password}`;
  UI accepts status 200 and reads `response.data.token`.
- `verifyToken`: GET `/api/v2/auth/verify-token`; Bearer authorization is
  installed by the frontend. UI reads `roles` on 200; on 401/403 it exposes
  registration only when the response has `setupAdmin: true`.
- `cruddb`: POST `/api/v2/cruddb`, `{data:{collection,mode,docID,obj}}`.
- Tools API Keys reads `ApiKeysJSONDB`, `mode:"getAll"`, `docID:""`, `obj:{}`;
  expects status 200 and an array response.
- Tools API Keys generates `tapi_` plus a random ID and inserts with
  `collection:"ApiKeysJSONDB"`, `mode:"insert"`, `docID:key`,
  `obj:{_id:key,date:Date.now()}`. Subsequent inventory uses `_id`.
- Frontend requests carry `x-tdarr-request-source: webui`.

The adapter persists its key before insertion, checkpoints before each
one-time request, and reconciles only that exact key after an ambiguous result.
It independently logs in after registration and verifies the admin role.
It creates no library, worker, node, transcode, or media mutation.

The adapter then repeats the read-only inventory with only `x-api-key` to
independently verify the saved key, using the authentication header documented
by the frontend API Docs panel and the official authentication guide.

Limits: key inventory does not prove internal-node connectivity. The recipe publishes
only 8265; server/API listener 8266 remains private. No read-only inspection
adapter is claimed because login and key inventory use POST. Live owner/key
authentication, node connectivity, and restart acceptance remain outstanding.
The [official authentication guide](https://docs.tdarr.io/docs/other/authentication/)
documents `seededApiKey`, but it is not used to substitute for owner creation.
