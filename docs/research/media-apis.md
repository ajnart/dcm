# Headless first-run APIs: Jellyfin, Seerr, Homarr

Research date 2026-10-06. Everything is from primary source read via `gh api` (no Docker run, no live calls).
Versions seen: Jellyfin 12.2 (`lscr.io/linuxserver/jellyfin:latest` = `12.2ubu2604-ls52`, from docker-jellyfin releases), Seerr v3.5.0, Homarr v2.2.0 (`dev` is 1 commit ahead of v2.2.0, identical onboarding code).
Cite format: `repo@ref:path`. "Verified" = read in source. Nothing here was exercised against a running container.

---

## 1. Jellyfin (`lscr.io/linuxserver/jellyfin:latest`, port 8096, config `/config`)

Sources: `jellyfin/jellyfin@master` and `release-10.9.z|10.10.z|10.11.z`: `Jellyfin.Api/Controllers/{StartupController,ApiKeyController,LibraryStructureController,UserController,SystemController}.cs`, `Jellyfin.Server.Implementations/Security/AuthorizationContext.cs`, `Jellyfin.Server/ServerSetupApp/SetupServer.cs`; `jellyfin/jellyfin-web@master:src/apps/wizard/controllers/*/index.js` (the real web wizard, same calls); `linuxserver/docker-jellyfin:readme-vars.yml`.

Auth header format used everywhere below (all versions):
`Authorization: MediaBrowser Client="selfhost", Device="selfhost-cli", DeviceId="selfhost-cli-<stable id>", Version="1.0.0"[, Token="<token-or-api-key>"]`
(`AuthorizationContext.GetParts`: comma separated, quoted values, URL-decoded.)

### Steps

0. Wait for readiness. `GET /System/Info/Public` (no auth) -> 200 JSON `{Id, ServerName, Version, ProductName, LocalAddress, StartupWizardCompleted: bool}`. While the host is still booting/migrating, `SetupServer` answers this path with `StartupWizardCompleted:false` (hard coded) and every other path with 503 + `Retry-After` (HTML). So: poll until 200 AND `Version` present, then re-read once after ~2 s before trusting `false`.
1. Idempotency gate. `StartupWizardCompleted == true` -> skip steps 2-6; go to step 7 (login with stored credentials). `false` -> run wizard.
2. `POST /Startup/Configuration` (no auth needed before Complete; policy `FirstTimeSetupOrElevated`).
   Headers: `Content-Type: application/json`. Body: `{"ServerName":"Jellyfin","UICulture":"en-US","MetadataCountryCode":"US","PreferredMetadataLanguage":"en"}` -> 204. Fields are all optional strings (nulls become ""). The web wizard does GET then POST twice (language page, metadata page) and POSTs the full object back. Note: 10.9/10.10 ignore `ServerName` in this DTO handler (10.10 source has no ServerName assignment; present from 10.11 on). Endpoint is `[Obsolete]` in 12.x but still routed. Optional step; skip if defaults are fine.
3. `GET /Startup/User` -> 200 `{"Name":"root"}` (10.9/10.10 also returned `Password`). MUST be called before step 4: it runs `UserManager.InitializeAsync()` which creates the placeholder first user (source comment "startup wizard requires an existing user"). Without it, 12.x/10.11 `POST /Startup/User` returns 404.
4. `POST /Startup/User` body `{"Name":"admin","Password":"<non-empty>"}` -> 204. Empty/whitespace password -> 400 `Password must not be empty`. Renames the placeholder user and sets the password. In master (12.x), if that user already has a password -> 403 (`Forbid`): this is the natural re-run guard. 10.9-10.11 have no such guard (a re-run would overwrite the admin password while wizard incomplete).
5. `POST /Startup/RemoteAccess` body `{"EnableRemoteAccess":true}` -> 204. In 10.9-10.11 DTO also has `EnableAutomaticPortMapping` (bool, UPnP; send `false`). In master the UPnP line was removed; extra property is ignored. Body is `[Required]`, send it.
6. `POST /Startup/Complete` (no body) -> 204. Afterwards `GET /System/Info/Public` must show `StartupWizardCompleted:true`. After this, all `/Startup/*` and `/Library/VirtualFolders` require an elevated (admin or API key) token.
7. Authenticate. `POST /Users/AuthenticateByName`
   Headers: `Content-Type: application/json`, `Authorization: MediaBrowser Client=..., Device=..., DeviceId=..., Version=...` (no Token).
   Body `{"Username":"admin","Pw":"<password>"}` -> 200 `{"User":{"Id","Name","Policy":{"IsAdministrator":true,...}},"SessionInfo":{...},"AccessToken":"<hex>","ServerId":"<id>"}`. 401 on bad credentials. Use `Authorization: MediaBrowser ..., Token="<AccessToken>"` on later calls. (Session tokens are per DeviceId; reusing the same DeviceId reuses the device record.)
8. Create API key (idempotent version): `GET /Auth/Keys` (token = admin session) -> `{"Items":[{"AccessToken","AppName","DateCreated","IsActive",...}],"TotalRecordCount":n}`. If an item with `AppName == "selfhost"` exists, reuse its `AccessToken`. Otherwise `POST /Auth/Keys?app=selfhost` (no body, `[Required]` query `app`) -> 204 with NO body; then `GET /Auth/Keys` again and pick the item whose `AppName` matches (take the last one if several). Seerr does exactly this (`seerr@v3.5.0:server/api/jellyfin.ts createApiToken`). Keys are persistent (no expiry); `app` names are not unique-constrained, so POST twice creates two keys.
   Use the key: `Authorization: MediaBrowser Token="<key>"` (works 10.9-12.x), or query `?ApiKey=<key>` (10.9-12.x). Key principal is treated as Administrator role (`CustomAuthenticationHandler`: `IsApiKey` -> Administrator). Key cannot call `/Users/Me` (400 "Token is not owned by a user").
9. Libraries. First `GET /Library/VirtualFolders` (admin/key) -> JSON array `[{"Name","Locations":["/data/movies"],"CollectionType":"movies"|null,"LibraryOptions":{...},"ItemId","RefreshStatus",...}]`. Skip creation if an entry with the same `Name` exists (compare `Locations`/`CollectionType`).
   Create: `POST /Library/VirtualFolders?name=Movies&collectionType=movies&refreshLibrary=false&paths=/data/movies` with `Content-Type: application/json` and body `{"LibraryOptions":{"PathInfos":[{"Path":"/data/movies"}]}}` (or `{}`/empty). `paths` query is comma-delimited; if given it overwrites `LibraryOptions.PathInfos`. -> 204. `collectionType` enum values (lowercase): `movies, tvshows, music, musicvideos, homevideos, boxsets, books, mixed`. Path must exist inside the container (`Directory.Exists` check -> 500-ish `ArgumentException "The specified path does not exist"`). `name` must match `^(?:\S(?:.*\S)?)$` in 12.x (no leading/trailing space).
   Idempotency WARNING: creating an already existing name does NOT fail; `LibraryManager.AddVirtualFolder` silently makes `Movies2`, `Movies3`... always `GET` first.
   Use `refreshLibrary=false` while creating several, then `POST /Library/Refresh` (204) once if a scan is wanted (Refresh endpoint not read in this pass).
10. Remove: library `DELETE /Library/VirtualFolders?name=Movies&refreshLibrary=false` -> 204. API key `DELETE /Auth/Keys/{key}` -> 204.

### Version differences
- 10.9 == 10.10 (StartupController identical). `GET /Startup/User` returns `Password` field; `UpdateStartupUser` uses `Users.First()`.
- 10.11: `GetFirstUser()` + 404 when none; `ServerName` honored in `/Startup/Configuration`; rename via `RenameUser`; `EnableLegacyAuthorization` property exists, default true.
- 12.x (12.0 Sept 2026 through 12.2): `Startup/*` marked obsolete but present; `POST /Startup/User` 403 if password already set; `ServerConfiguration.EnableLegacyAuthorization` defaults false AND migration `20260531160000_DisableLegacyAuthorization` forces it false. Effects: `X-Emby-Authorization`, `X-Emby-Token`, `X-MediaBrowser-Token` headers, `Authorization: Emby ...` scheme and `?api_key=` are rejected. Use only `Authorization: MediaBrowser ...` and `?ApiKey=`. `ApiKeyController` (GET/POST/DELETE `/Auth/Keys`) unchanged 10.9 -> 12.
- `jellyfin-web@master` wizard still posts the same four Startup endpoints, so the contract is stable.

### Unverified / risky (Jellyfin)
- Exact 12.2 behavior of `GET /Auth/Keys` item field names was not diffed (the old TS adapter in `.agents/.../apps/jellyfin/setup.ts` pins v12.1 and uses `Items[].AccessToken/AppName/IsActive`, `TotalRecordCount`; trusted but not re-read in model source).
- `StartupWizardCompleted:false` is also returned during boot by `SetupServer` (see step 0); a naive "false -> run wizard" can fire against a half-booted server. Mitigate with double read plus 503 handling.
- 10.9-11 `POST /Startup/User` has no re-run guard: an interrupted second run can overwrite the admin password while the wizard is not completed. Persist a "wizard started" checkpoint.
- Library path must exist and be readable in the container; `lscr` mounts conventionally at `/data/movies`, `/data/tvshows` (readme-vars.yml), but this repo's compose may differ.
- Library refresh endpoint (`POST /Library/Refresh`) and `LibraryOptions` defaults (metadata fetchers, realtime monitor) not verified; empty options accepted per source but resulting defaults unseen.
- Jellyfin accepts brute-force lockout on repeated failed `AuthenticateByName` (not read); avoid retry loops with a wrong password.

---

## 2. Seerr (`ghcr.io/seerr-team/seerr:latest`, port 5055, config `/app/config`)

Verified: image `ghcr.io/seerr-team/seerr:latest` (also Docker Hub `seerr/seerr`), `EXPOSE 5055`, volume `/app/config` (container user `node` uid 1000, so chown the host dir), healthcheck `GET /api/v1/settings/public` (`seerr@v3.5.0:docs/getting-started/docker.mdx`, `Dockerfile`). All routes are under `/api/v1`. Sources: `seerr@v3.5.0:server/routes/{index.ts,auth.ts,settings/index.ts,settings/sonarr.ts,settings/radarr.ts}`, `server/middleware/auth.ts`, `server/index.ts`, `server/lib/settings/index.ts`, `server/api/jellyfin.ts`, `server/api/servarr/base.ts`, `seerr-api.yml`. `main` equals v3.5.0 for these routes.

Request bodies are validated by `OpenApiValidator` against `seerr-api.yml` (`validateRequests: true`): missing required fields -> 400 before the handler runs.

### Auth model
- Session: `express-session` default cookie name `connect.sid` (no custom name set), `httpOnly`, 30 days, `sameSite` strict only if `network.csrfProtection` (default off), `secure:'auto'`. Keep a cookie jar; `Set-Cookie` is issued on the first `POST /auth/jellyfin` response.
- API key: header `X-Api-Key: <settings.main.apiKey>`, acts as user id 1 (or `X-API-User: <id>`). Key readable via `GET /api/v1/settings/main` -> `apiKey` (admin only). Can be pinned with env `API_KEY=<value>` (docs `using-seerr/settings/general.md`; code overwrites stored key at load if env set). Using the key requires user id 1 to exist, i.e. only after step 2.
- `GET /api/v1/auth/me` -> 200 user JSON when session valid, 403 otherwise. `POST /api/v1/auth/logout`.

### Steps
1. Gate. `GET /api/v1/settings/public` (no auth) -> `{"initialized":bool,"mediaServerType":4|2|1|3,"applicationTitle":...}`. `mediaServerType`: 1 Plex, 2 Jellyfin, 3 Emby, 4 NOT_CONFIGURED. `initialized:true` -> already finished, skip to step 7 verification. Also `GET /api/v1/status` -> `{version,...}` for readiness.
2. Create admin + bind Jellyfin (first call). `POST /api/v1/auth/jellyfin`, `Content-Type: application/json`, no auth:
   `{"username":"admin","password":"<jellyfin admin pw>","hostname":"jellyfin","port":8096,"useSsl":false,"urlBase":"","email":"admin@example.test","serverType":2}`
   - `hostname` is bare host (no scheme/port); `serverType` 2 = Jellyfin (3 Emby); `username`+`password` required by schema; `email` optional (defaults to the Jellyfin username).
   - Succeeds only if the Jellyfin account `Policy.IsAdministrator` (else 403 `NOT_ADMIN`) and no Seerr users exist yet (or mediaServerType NOT_CONFIGURED). Creates user id 1 (admin), stores `settings.jellyfin{ip,port,useSsl,urlBase,apiKey,serverId,name}`, sets `mediaServerType`, AND creates its own Jellyfin API key `AppName="Seerr"` (POST `/Auth/Keys?App=Seerr` then GET `/Auth/Keys`). Returns 200 user JSON + session cookie.
   - Re-run: once `settings.jellyfin.ip` is set, sending `hostname` -> 500 `Jellyfin hostname already configured`; log in again WITHOUT `hostname` (`{"username","password"}`) to get a new session (existing-user path).
3. Capture API key. `GET /api/v1/settings/main` (session cookie) -> `{"apiKey":"...",...}`. Store privately; reuse as `X-Api-Key` and as the Homarr `seerr` integration secret.
4. Sync Jellyfin libraries (needs the libraries to exist in Jellyfin first).
   `POST /api/v1/settings/jellyfin/library/sync` (no body) -> 200 `[{"id":"<jellyfin itemid>","name":"Movies","enabled":false,"type":"movie"|"show"}]`. 404 `SyncErrorNoLibraries` if Jellyfin has none. New libs default `enabled:false`; existing keep their state.
   Enable: `PUT /api/v1/settings/jellyfin/library/{id}` body `{"enabled":true}` -> 200 library JSON (400 invalid body, 404 unknown id). Verify: `GET /api/v1/settings/jellyfin/library`.
   (Old Jellyseerr `GET /settings/jellyfin/library?sync=true&enable=` does NOT exist in v3.5.0.)
   Optional: `POST /api/v1/settings/jellyfin/sync` body `{"start":true}` triggers the scan job (not read in detail).
5. Sonarr link. Discover profiles/folders: `POST /api/v1/settings/sonarr/test` body `{"hostname":"sonarr","port":8989,"apiKey":"<sonarr key>","useSsl":false,"baseUrl":""}` -> 200 `{"profiles":[{"id":1,"name":"Any"}...],"rootFolders":[{"id":1,"path":"/tv"}],"languageProfiles":null|[...],"tags":[...],"urlBase":""}`; 500 `Failed to connect to Sonarr`. (`languageProfiles` only for Sonarr v3.) URL built as `http(s)://hostname:port + baseUrl + /api/v3`.
   Create: `POST /api/v1/settings/sonarr` -> 201 with assigned `id` (first = 0, then last+1):
   ```json
   {"name":"Sonarr","hostname":"sonarr","port":8989,"apiKey":"<key>","useSsl":false,"baseUrl":"",
    "activeProfileId":1,"activeProfileName":"Any","activeDirectory":"/tv",
    "is4k":false,"isDefault":true,"enableSeasonFolders":true,
    "syncEnabled":false,"preventSearch":false,"tagRequests":false,"tags":[],"animeTags":[],"overrideRule":[],
    "seriesType":"standard","animeSeriesType":"standard","monitorNewItems":"all"}
   ```
   Required by schema: `name,hostname,port,apiKey,useSsl,activeProfileId,activeProfileName,activeDirectory,is4k,enableSeasonFolders,isDefault`. `isDefault:true` clears other defaults with the same `is4k`.
6. Radarr link: same as step 5 on `/api/v1/settings/radarr/test` (returns `profiles, rootFolders, tags, urlBase`) and `POST /api/v1/settings/radarr`. Required: `name,hostname,port,apiKey,useSsl,activeProfileId,activeProfileName,activeDirectory,is4k,minimumAvailability,isDefault`. Use `"minimumAvailability":"released"` (Radarr values: `announced|inCinemas|released`; the OpenAPI example "In Cinema" is not a Radarr value).
   Idempotency for 5/6: `GET /api/v1/settings/sonarr|radarr` -> array; match on `hostname`+`port`; update with `PUT /api/v1/settings/sonarr/{id}` (full body, id from path) rather than POST again.
7. Finish. `POST /api/v1/settings/initialize` (admin, no body) -> 200 `public` settings `{"initialized":true,...}`. Without this the web UI keeps redirecting to `/setup`. Verify `GET /api/v1/settings/public` -> `initialized:true`.
8. Remove a link: `DELETE /api/v1/settings/sonarr/{id}` (or `/radarr/{id}`) -> 200 with removed object, 404 if missing. Disable library: `PUT .../jellyfin/library/{id}` `{"enabled":false}`.

### Unverified / risky (Seerr)
- Library sync lists libraries via Jellyfin `/Library/MediaFolders` using the Jellyfin API key with `Authorization: MediaBrowser ... Token="..."` (verified modern header, fine on Jellyfin 12 where legacy auth is disabled). `type` mapping (`movie`/`show`) from `mapLibraries` not read.
- Full Sonarr/Radarr payload: the UI sends more fields than the OpenAPI "required" list (`tags`, `overrideRule`, `tagRequests`, `monitorNewItems`, `seriesType`, ...). Omitting them passes validation but later code may read them (e.g. `tags.length`); sending the full set above is a guess based on the `DVRSettings` TS types, not on a captured UI request.
- `minimumAvailability` accepted values only inferred.
- `settings.jellyfin.apiKey` created by Seerr is a second Jellyfin key (`AppName=Seerr`); do not delete it. Seerr rejects `POST /auth/jellyfin` with `hostname` once configured (500, not 409).
- First admin must be a Jellyfin administrator; if the CLI's Jellyfin admin password later changes, Seerr's stored token (user.jellyfinAuthToken) stays valid until revoked.
- Seerr does a media-server scan job asynchronously; "libraries enabled" is not "content available". Not acceptance evidence.
- Image `latest` tracks 3.x stable (v3.5.0 tagged 2026-09-28); pin a tag for reproducibility.

---

## 3. Homarr (`ghcr.io/homarr-labs/homarr:latest`, port 7575, `SECRET_ENCRYPTION_KEY` = 64 hex chars)

Sources: `homarr-labs/homarr@v2.2.0` (== dev): `packages/api/src/router/onboard/onboard-router.ts`, `onboard-queries.ts`, `packages/api/src/{trpc.ts,onboarding-claim.ts}`, `packages/api/src/router/{user,integration/integration-router,app,board,apiKeys}.ts`, `packages/validation/src/{onboarding,integration,app,board,user}.ts`, `packages/definitions/src/integration.ts`, `packages/auth/api-key/*`, `apps/nextjs/src/app/api/{onboarding/claim,trpc/[trpc],health}`; local reference `packages/cli/src/lib/homarr-onboarding-api.ts` (same flow, matches source). Health: `GET /api/health/live` and `/api/health/ready`.

### Transport (tRPC, superjson)
- Base `POST|GET /api/trpc/<router>.<proc>`. Mutation: `POST`, `Content-Type: application/json`, body `{"json": <input>}` (no-input mutation: send `{"json":null}` or empty object; local TS sends `{}`). Query: `GET /api/trpc/<proc>?input=<urlencoded {"json":<input>}>`. Response `{"result":{"data":{"json": <value>}}}`; error -> non-2xx with `{"error":{"json":{"message","code","data":{"code","httpStatus"}}}}`.
- Auth: either NextAuth session cookie, or header `ApiKey: <id>.<token>` (`API_KEY_HEADER_NAME = "ApiKey"`) which works on `/api/trpc/*` for every procedure, not just REST ones.
- Login (session): `GET /api/auth/csrf` -> `{"csrfToken"}`; `POST /api/auth/callback/credentials` `application/x-www-form-urlencoded` body `name=<user>&password=<pw>&csrfToken=<t>&callbackUrl=<origin>`, header `X-Auth-Return-Redirect: 1` (-> 200 JSON); then `GET /api/auth/session` -> `{"user":{"name","permissions":["admin",...]}}`. Keep cookie jar (`authjs.*` cookies plus the claim cookie).

### Onboarding steps (fresh instance)
1. `GET /api/trpc/onboard.currentStep` -> `{"current":"start|user|group|setup|finish","previous":...}`. `finish` -> already onboarded, skip to section "After onboarding". (Env var for credentials provider must be enabled; default is.)
2. Claim. `POST /api/onboarding/claim` (no body; do not send a cross-site `Sec-Fetch-Site`) -> 200 `{"status":"issued"|"active","expiresAt":ms}` and `Set-Cookie: homarr-onboarding-claim=<token>; HttpOnly; SameSite=Strict` (TTL 4 h). 423 `locked` if another client holds a live claim; 409 `finished`; 403 `administrator_required` if users exist and caller is not admin. All `onboard.*` and `user.initUser` mutations need this cookie (or an admin session).
3. If `current=="start"`: `POST /api/trpc/onboard.nextStep` -> step becomes `user` (`PRECONDITION_FAILED` if not at `start`).
4. Admin user: `POST /api/trpc/user.initUser` body `{"json":{"username":"admin","password":"<pw>","confirmPassword":"<pw>","email":"admin@example.test"}}`. Requires step `user`. Creates the user in the credentials admin group; step -> `setup` (or `group` if LDAP/OIDC enabled). Password schema: `min 8, max 255` (the UI shows complexity hints; server schema in `userPasswordSchema` is length only; `userBaseCreateSchema` itself not diffed). Username lowercased by local TS; 3-255 chars.
5. Login as that admin (cookie flow above). Required: after the first user exists, claim-only access is denied (`isClaimOnlyOnboardingAccessAllowedAsync` needs "no users"), so `completeSetup` needs the admin session.
6. `GET /api/trpc/onboard.currentStep` must be `setup`.
7. One-shot configuration: `POST /api/trpc/onboard.completeSetup` (timeout generously, 120 s in TS). Body:
   ```json
   {"json":{
     "server":{"defaultLocale":"en","defaultColorScheme":"dark","analyticsEnabled":false},
     "board":{"name":"Home","primaryColor":"#228BE6","secondaryColor":"#15AABF","itemRadius":"md","layoutPreset":"balanced","leftSidebar":false,"rightSidebar":false},
     "selectedIntegrationIds":[],"selectedAppIds":[],
     "integrations":[
       {"sourceId":"sonarr","name":"Sonarr","kind":"sonarr","url":"http://sonarr:8989","secrets":[{"kind":"apiKey","value":"<key>"}]},
       {"sourceId":"qbittorrent","name":"qBittorrent","kind":"qBittorrent","url":"http://qbittorrent:8080","secrets":[{"kind":"username","value":"admin"},{"kind":"password","value":"<pw>"}]}
     ],
     "apps":[{"sourceId":"homepage-extra","name":"Foo","href":"http://host:1234","iconUrl":null}],
     "selectedDockerSourceIds":[],"selectedWidgetKinds":[]}}
   ```
   Behavior (verified): board `name` must match `^[A-Za-z0-9-_]*$` (no spaces); `sourceId` required per integration/app, unique, trimmed; ids are deterministic: integration id `onboarding_integration_<sha256(sourceId)[0:32]>`, linked app id `onboarding_app_<sha256(sourceId)[0:32]>` (so a retry is idempotent for existing rows: `existing` flag, tiles not duplicated if app already on board). It runs `testConnectionAsync` for each integration but a FAILED test only logs a warning and the integration is still created (differs from `integration.create`). It creates the board (Mobile + Base layouts) if none exists, creates one app per integration (`href` and `pingUrl` default to the integration `url`, icon from kind) and places one `app` tile (1x1, `{"appId","openInNewTab":true,"showTitle":true}`) per integration/app on the main section, sets home board + mobile home board, encrypts secrets (`encryptSecret`, needs `SECRET_ENCRYPTION_KEY`), then step -> `finish` and deletes the claim. Response is empty success.
   Optional: `POST /api/trpc/onboard.testIntegration` (step `setup`) with one integration draft -> `{"success":bool}`.
8. Verify: `onboard.currentStep` -> `finish`; `GET /api/trpc/integration.all` (session) lists the integrations.
9. API key (for later calls without cookie): `POST /api/trpc/apiKeys.create` (admin session) -> `{"json":{"apiKey":"<id>.<token>"}}` (returned once; stored hashed). Validate with header `ApiKey: <id>.<token>` on `GET /api/trpc/apiKeys.getAll` (-> array; 401/403 invalid). Delete: `POST /api/trpc/apiKeys.delete` `{"json":{"apiKeyId":"<id>"}}`.

### After onboarding (add/update/remove things)
- Integration kinds & secrets (verified in `definitions/integration.ts`): `sonarr`,`radarr`,`prowlarr`: `[apiKey]`. `qBittorrent`: `[apiKey]` OR `[username,password]`. `jellyfin`: `[username,password]` OR `[apiKey]`. `seerr` (exists in v2.2.0, features onboarding order 5), `jellyseerr`, `overseerr`: `[apiKey]`. `ntfy`: `[topic]` OR `[topic,apiKey]` (`topic` is a public secret; url is the ntfy server). Secret kinds are exact strings: `apiKey, username, password, topic, tokenId, realm, personalAccessToken, ...`. `GET /api/trpc/integration.getKinds` lists kinds at runtime.
- Create (tested before saving): `POST /api/trpc/integration.create` body `{"json":{"name":"Radarr","url":"http://radarr:7878","kind":"radarr","secrets":[{"kind":"apiKey","value":"..."}],"attemptSearchEngineCreation":false,"app":{"id":"<existing app id>"}}}` (`attemptSearchEngineCreation` required; `app` optional: `{id}` or full `{name,description,iconUrl,href,pingUrl}`; `url` must be `http(s)://`). On failed connection test it returns HTTP 200 with `{"error":...}` in `data.json` and creates nothing, so check `data.json.error`. Success returns `{integration:{id,...}}` (id is random; no external idempotency key), so list first with `integration.all` and match by `kind`+`url`.
- Update secrets/url: `POST /api/trpc/integration.update` `{"json":{"id","name","url","secrets":[{"kind","value":<string|null>}],"appId":<string|null>}}`.
- Remove ("Link"): `POST /api/trpc/integration.delete` `{"json":{"id":"<integrationId>"}}` (NOT_FOUND if absent). The linked app/tile stays; remove with `DELETE /api/apps/{id}` (REST, needs ApiKey header and `app-full-all`) and board item removal via board save (no REST delete-item found).
- Apps (tiles' backing record): REST `POST /api/apps` body `{"name","description":null,"iconUrl":"https://.../x.svg","href":"http://host:port","pingUrl":"http://svc:port"}` -> `{"appId","id",...}`; `PATCH /api/apps/{id}` full body; `GET /api/apps`. Use PATCH to replace the internal `href` created by onboarding (`http://sonarr:8989`, only reachable from inside the Docker network) with a browser-reachable URL; keep `pingUrl` internal.
- Place tile on board: REST `GET /api/boards` (find `id`), then `POST /api/boards/items` body `{"boardId":"<id>","kind":"app","options":{"appId":"<appId>","openInNewTab":true,"showTitle":true},"size":{"width":1,"height":1},"integrationIds":[]}` -> `{"itemId"}`; places at first free slot in the main section. Same via tRPC `board.addItem`.
- REST/OpenAPI: spec generated by `trpc-to-openapi` (served by `apps/nextjs/src/app/api/openapi/route.ts`; exact URL not confirmed) with `securitySchemes.apikey` header `ApiKey`. Exposed REST routes only: apps (`/api/apps*`), boards (`/api/boards*`, incl. `/api/boards/items`), users, `/api/settings/board`, `/api/info`, `/api/integrations/request` (proxy a call through a stored integration), `/api/integrations/{id}/test-connection`, certificates. There is NO REST route for integration create/update/delete or onboarding; those are tRPC only. An MCP endpoint (`/api/mcp`) also exposes `integration_create`/`delete`, app and board tools with an API key (not read in detail).

### Unverified / risky (Homarr)
- `integration.create` returns 200 with `{error}` on failed test; `onboard.completeSetup` creates integrations even when tests fail. A CLI that treats HTTP 200 as success will report false positives; always read the body and then `integration.all`.
- Onboarding app `href` equals the internal integration URL (`http://sonarr:8989`); tiles link to unreachable URLs from a browser until patched. completeSetup offers no per-integration href override (only `iconUrl`, `description`, `pingUrl`).
- tRPC body for no-input mutations (`nextStep`, `apiKeys.create`): local TS sends `{}` and works per its tests; `{"json":null}` equally plausible but unverified. Do not assume the SuperJSON `meta` field is needed for plain JSON (it is not for strings/numbers/booleans/null; Dates would need it).
- Claim cookie semantics: `SameSite=Strict` and `Secure` only when https/`X-Forwarded-Proto: https`; with a plain-HTTP client jar it works, but a reverse proxy adding `Sec-Fetch-Site: cross-site` gets 403 `cross_site`. TTL 4 h; a second concurrent claimant gets 423.
- After step 4, session login is mandatory for step 7; the local TS verifies `permissions` includes `admin` from `/api/auth/session`.
- Homarr's own connection tests for `jellyfin` use the modern `Authorization: MediaBrowser ...` header (OK on Jellyfin 12). Jellyfin `username/password` mode makes Homarr log in on every start; prefer the Jellyfin `apiKey`. qBittorrent integration over `apiKey` depends on qBittorrent version supporting API keys; username/password is the safe mode (qBittorrent whitelist/CSRF settings may reject Homarr's Host header: unverified).
- Password complexity: validated only by length at server (`userPasswordSchema`); the UI-only complexity hints may differ; use a 16+ char random password.
- `SECRET_ENCRYPTION_KEY` loss makes stored secrets undecryptable (secrets are AES via `encryptSecret`); do not regenerate on re-run.
- Homarr v2 onboarding endpoints (`/api/onboarding/claim`, `onboard.*`) are v2.x only; v1.x `/init` flow differs. `latest` currently resolves to v2.2.0 (2026-10-05); pin a tag.
