# Catalog contract

The catalog is data, not deployment authority. `catalog/taxonomy.json` defines goal-facing categories, `catalog/apps/<app-id>/manifest.json` owns each app record, and `catalog/stacks/*.json` contains goal recipes. `catalog/skills.json` declares every packaged skill and whether a specialized adapter is scoped to one application or one complete stack. `catalog/homarr-integrations.json` is the checked registry of exact Homarr integration identifiers and display names. JSON Schemas live in `catalog/schemas/`.

`catalog/affiliates.json` is an optional, empty-by-default disclosure registry. An entry may contain only an app/provider ID, disclosed URL, disclosure text, regions, check date, and enabled flag. Affiliate data is presentation-only: it never changes search scores, ordering, defaults, stack resolution, or plan choices. Never add a link without a real disclosed relationship and a current destination.

## Add an application

1. Create `apps/<app-id>/manifest.json` with the same stable lower-case ID and one or more taxonomy categories. Only include software this CLI can provision as a Docker Compose service or bounded Compose job. Docker itself, host platforms, local clients, protocols, and retired products are not app entries. The runtime discovers app folders: removing one hides that app, dependent apps, and goals whose required default is gone. It never silently picks a replacement. Optional choices and Homarr coverage for a removed app disappear. Homarr's own folder is required by the current catalog contract.
2. Keep the upstream project, source repository, documentation, and container image as separate fields.
3. Record lifecycle and `checkedAt`; use `verify` when current status is uncertain and `retired` only with migration evidence.
4. Select automation support independently from T0/T1/T2 priority. `managed` requires an installed `adapterSkill`.
5. Record Homarr as `supported`, `partial`, or `gap`; a URL tile is `partial`, not a dedicated integration. An optional HTTPS `homarr.iconUrl` is presentation data for an app tile, not integration or reachability evidence.
6. Include roles, dependencies, evidence-based alternatives, security requirements, pitfalls, and primary sources. Use an empty `alternatives` list when no supported substitute is appropriate; never invent one just to fill the field. Use `null` for unknown deployment facts.
7. Run `bun scripts/selfhost.ts catalog validate`.

The optional `cliSetup` block belongs to an application with a packaged, bounded CLI adapter. Its `command` must be the exact app ID and a registered CLI route; its `platform` is currently `linux`, and its short `note` describes the remaining acceptance work. It changes the app's setup stage and the terminal planner's next command, but does not promote guided support to managed or approve an apply. Add a descriptor only after its CLI route exists and is tested.

Optional `frontend` metadata declares `{kind: "web", protocol: "http" | "https"}`,
`{kind: "tcp", protocol: "postgresql" | "redis"}`, or `{kind: "none"}`.
Omission preserves the legacy web/HTTP presentation default. Classify non-web
apps explicitly; never infer protocol from a port number. TCP apps expose
credential-free host/port metadata, not browser links or Homarr HTTP tiles.
This manifest-only presentation field does not alter saved recipe identity,
establish reachability, or prove application acceptance.

An app may also carry `apps/<app-id>/recipe.json` for a declarative Compose candidate. The recipe is optional and separate from `manifest.json`: it records pinned image tags, service ports and mounts, storage requirements, private default bind, and explicit acceptance checks. Conform to `schemas/compose-recipe.schema.json`; the runtime additionally matches the app ID, image and primary source against the app manifest and rejects secret-like values. Inspect a candidate with `self-host catalog recipe <app-id> --json`. This command is read-only and returns the recipe's SHA-256. Six explicitly registered app routes now set `recipeCapability.boundedApply`; Gotify, Jellyfin, Sonarr, Radarr, and qBittorrent remain inspect-only candidates for standalone `app apply` until their deployment/setup routes and fresh-instance acceptance are verified. On a local Linux Docker host, `self-host app plan` can review a digest-pinned eligible candidate and issue an exact `APP-APPLY` approval; `app apply` re-inspects, records an owner-only checkpoint, and delegates scoped deployment to `selfhost-compose`. `app resume` only continues before ambiguous Docker resources appear. An operator-supplied digest is not registry verification, and Compose start is not first-account, monitor, or restart-persistence acceptance. A recipe alone does not promote automation support or promise a one-command install.

Optional `apps/<app-id>/recipe-image-history.json` records up to 16 previous
image sets for an existing v2 recipe. Each entry declares its canonical sorted-key
JSON SHA-256 and exactly the current service IDs with `imageTag` and
`imageSource`. Loading reconstructs the current template with only those image
fields changed and validates both the recipe and hash. History preserves exact
saved owners; it never authorizes an upgrade or changes other recipe fields.

`app shared` plans compatible validated v2 recipes in one reviewed Compose project. It
discovers `apps/<app-id>/setup.ts` beside each recipe and runs those headless
adapters through the common HTTP, secret, approval, and checkpoint interface.
For a source-backed owner-issued token consumed through a documented file
variable, a v2 recipe may declare one `privateFiles` entry with
`source: "owner"` and `maxBytes`, bind it through `fileEnvironment`, and use
`onboarding.kind: "external-secret"`. The exact reviewed apply/add/resume
accepts `--secret-file APP:FILE=/absolute/mode-0600/path` or one piped
`--secret-stdin APP:FILE`. It imports bytes into the owner-only project once;
subsequent preparation reuses or compares the saved file. Plans, approvals,
Compose, and ordinary status contain no payload. This is not account creation,
remote-scope verification, public-exposure approval, or an API-key extraction
claim. Opaque owner files cannot use ordinary `secretEnvironment` bindings.
The bounded connector-only `owner-json` exception below explicitly exposes its
reviewed credential to Docker operators. `fileEnvironment` also
accepts documented `*_SECRETFILE` names. For upstreams that accept a file URI
in a secret variable, use `{name, fileId, format: "file-uri", officialUrl}`;
the file must be owner-issued and the HTTPS evidence URL must be a listed app
source. This renders `file:/run/secrets/<fileId>` without loading the payload
into the environment. It does not verify enrollment or the token's remote scope.
For a generated private configuration path, `fileEnvironment` may instead use
`format: "private-config-path"`, its declared `privateConfigs` ID and exact listed
publisher source. The consuming service must mount that configuration read-only
at `/run/secrets/<fileId>`. Canonical provenance is `source: "generated-config"`,
not owner issuance; rendered environment contains only the path, never bytes.
For documented plain-path consumers whose name is not `*_FILE` (for example
`MINIO_LICENSE` or WUD's Docker TLS `CAFILE`/`CERTFILE`/`KEYFILE` settings), use
`{name, fileId, format: "file-path", officialUrl}`. It requires a declared
owner-issued file and an HTTPS URL exactly in the app's `sources`; do not infer
file syntax from a credential-like name. This renders `/run/secrets/<fileId>`,
never bytes or a `file:` URI. The compiler carries the typed owner-file consumer
and publisher provenance into the Compose manifest and approval fingerprint.
Other generated login/password bindings and onboarding remain independent.

A publisher-documented connector JSON environment input may use
`{name, fileId, format: "owner-json", officialUrl, jsonFields}`. It requires an
imported owner file, a listed publisher source, and exactly the declared string
fields; preparation emits bounded literal-safe JSON into a mode-0600 env file.
It rejects additional fields, non-string values and unsafe interpolation or
escaping. This is not arbitrary secret-payload approval, generated enrollment,
or authority to activate a route. Credentials remain visible to Docker
operators and container processes. An imported provider credential with
`consumer: "pre-start"` stays owner-only for the consumed prerequisite facility;
it is not mounted or injected into the connector.

Cloudflare's derived local-tunnel recipe uses the documented
[`TUNNEL_CRED_CONTENTS`](https://github.com/cloudflare/cloudflared/blob/2026.9.1/cmd/cloudflared/tunnel/subcommand_context.go)
input with the image's default nonroot user. Its prepared shared owner requires
separate `app shared cloudflare-read-plan` / `cloudflare-read-apply` approval for
fixed provider GETs, then `cloudflare-public-plan` / `cloudflare-public-apply`
approval for the exact selected same-owner origin, local config, credential/env
bytes and observed routing/DNS/TLS/Access owners. Neither imported bytes nor read
approval imply public consent. Every startup rechecks the retained contract;
native edge readiness is not client DNS/TLS, Access enforcement or application
delivery acceptance. See the app's
[provider read contract](catalog/apps/cloudflare-tunnel/provider-read-contract.md)
for scope input and immutable approval-state limits.

Use the [headless setup patterns](headless-setup-patterns.md) when adding an app:
choose a proven bootstrap pattern, keep only app-specific requests in its adapter,
and record an explicit gap when the pinned upstream has no safe route.
A recipe without an adapter can be planned, but setup reports it as pending;
Compose start does not promote it to managed support. `no-account` onboarding
declares an app with no generated login or API key (`privateFiles: []`); its
adapter must verify an upstream-documented private endpoint, not invent an
administrator. App-specific links and restart persistence remain separate
acceptance checks.

An app adapter may declare non-secret `inputDefinitions` for first-run choices.
Pass them as repeated `--input APP.KEY=VALUE` arguments to `app shared setup`;
review and approval bind the exact values, and the adapter saves any choice
needed to resume a partially completed setup. The shared engine validates the
declared keys and keeps app-specific behavior in that app's `setup.ts`.
`setupAfter` declares optional ordering edges among apps selected for the same
shared setup run. Independent adapters still run together; a dependent runs
only after each selected predecessor is ready. Its adapter must inspect any
required peer through the exact shared-owner read-only peer interface.

When an upstream image cannot consume a `*_FILE` secret, `secretEnvironment`
binds a generated `privateFiles` ID to one environment name. The shared
preparation step writes an owner-only `0600` env file; the manifest and Compose
file contain its path, not its values. The typed `postgres-url` form composes
`DATABASE_URL` from one generated password and a selected in-recipe database
service, username, port, and database name. Do not embed credentials or arbitrary
interpolation in catalog JSON. Container-environment secrets remain visible to
operators with Docker inspection access.
For documented structured environment settings, `secretEnvironment` may use
`{name,fileId,format:"private-config",officialUrl}`, where `fileId` names an
existing `privateConfigs` declaration and its exact listed evidence URL.
That declaration reuses literal/generated-file parts, with exactly one consuming
service through either this environment binding or a private config mount, never
both. Preparation saves and verifies the mode-`0600` configuration, then writes
only that service's selected bindings into its mode-`0600` env file. Values are
single-line, at most 4096 bytes, and reject dollars, apostrophes, backslashes and
control characters; quoted serialization performs no evaluation or interpolation.
JSON-style double-quoted dictionaries and credential URIs therefore need no
app-specific expression language. Existing derived files and env contents must
match exactly on resume. Only generated base64url/alphanumeric/hex sources are
supported, not arbitrary owner input. These are plaintext container environment
values visible to Docker inspection and container processes, not secret-mounted
files; plans and Compose contain only the service-local env-file path.
For upstream apps requiring a literal, non-secret configuration file, a v2
recipe may declare bounded `configFiles` and mount each one exactly once with
`kind: "generated-file"` and its `fileId`. Preparation writes each reviewed
content blob to a project-owned mode-`0600` file and mounts it read-only; resume
rejects changed content, links, or permissions. The selection approval binds
the recipe content. Do not use this for credentials or operator-specific
settings, and verify that the image's documented runtime user can read the
owner-only mount before adding a recipe. An explicit `readability: "container"`
exception requires `officialUrl` to exactly match a listed app publisher source;
it creates a mode-`0644` non-secret file under the unchanged mode-`0700` parent
and retains the read-only mount. Omission remains mode-`0600`. Review shows this
exception, resume verifies exact mode/bytes/ownership without repairing files,
and container-readable content rejects bcrypt environment references as well as
secret assignments and credential URLs. Private configs and secrets stay `0600`.
A generated file is not a substitute
for a first-run setup adapter or application acceptance.
The typed `ntfy-auth-users` form is limited to ntfy's documented deny-all
policy and `admin:<bcrypt>:admin` declaration. It derives a bcrypt hash from
the saved administrator password, keeps literal dollar signs in the owner-only
env file, and verifies the same hash/password on resume. It does not create a
publisher, topic ACL, or API token; those require separate acceptance.
The generic `bcrypt-hash` secret-environment form derives only a bcrypt hash
from a generated private password and saves that hash in an owner-only env
file. A literal generated config may refer to that exact variable as
`password: process.env.NAME` only on the service that mounts the config.
Resume verifies the stored hash against the saved password before Docker
starts. The hash is visible to Docker operators, not the plaintext password;
an adapter must still prove login and account ownership.
`initial-admin-email-from-secret-env` uses the same private password binding
but records an actual email login identity in shared status and handoff. It
applies only to an upstream-documented empty-database bootstrap; a restart
must verify the saved credential rather than assume the environment reset it.
`initial-password-from-file` covers documented password-only apps with no
username. Shared status and handoff report a null username and the exact
owner-only password file; an adapter must still verify authentication.
`initial-admin-password-file` covers an image with a fixed `admin` login and
a documented password-file environment variable, but no separate username
environment variable. Shared status and handoff retain the `admin` username.
`manual-first-password` uses the same password-only handoff when a documented
first-run HTTP route creates the account. Its adapter must checkpoint before
the first write and verify the generated password against the saved account;
the recipe does not invent a username.
`manual-first-email` records a documented email login identity for an HTTP
first-owner route. Shared handoff reports the email and generated password
separately; the adapter must verify login and never present the email as a
username-only account.
`seeded-admin-rotation` is for an image with a documented, publicly known
first administrator. The recipe stores only the intended `admin` identity and
generated replacement-password reference; the app adapter owns the pinned
seeded-login facts, checkpoints before rotation, verifies the new login, and
refuses an existing administrator it cannot prove it owns. Public defaults
must not be mistaken for saved owner credentials.
`base64-prefixed` private files contain `base64:` followed by standard Base64
of the selected random byte count for images that document that exact key
format. Bind the file through an upstream-supported `*_FILE`/`FILE__*` input;
the raw secret-environment path intentionally rejects its punctuation.
`base64` instead contains canonical padded standard Base64 of 32–128 actual
random bytes. Preparation and private-config assembly verify decoded byte count
and exact re-encoding on resume. It supports reviewed private config literals
and documented file inputs, not direct raw secret-environment bindings.
`derivedEnvironment` can append a bounded, literal `pathSuffix` to the exact
selected loopback origin for apps whose auth base URL includes a path. It
cannot interpolate secrets, query strings, fragments, or an external host.
The `local-host-authority` source instead derives only `127.0.0.1:<selected-port>`
(or bracketed IPv6), with no scheme or path, for upstream settings that require
an exact host authority. It does not imply remote reachability or HTTPS.

Version 2 `multi-service-compose` recipes describe one to eight bounded service IDs, fixed image tags, mounts, dependency edges, generated private-file inputs, first-admin handling, and typed host UID/GID bindings for writable folders. Seerr's `external-first-admin` names the selected Jellyfin provider; it has no separate local password. A source-backed recipe can request Compose `init: true`; unsupported shell health commands are not silently converted to argv checks. A mount may set `kind: "volume"` for a project-owned Docker local volume; omitted kind remains a legacy app-data bind. New bind mounts may set `kind: "bind"`; `hostPath: true` requires an exact selected absolute path keyed by the mount ID and fails closed when the selection is missing or extra. Those paths are not stored in catalog data or inferred from the host. A path with a writable claimant may be shared only when all claimants carry the same explicit `shareGroup` and the exact source is project-owned; each claimant keeps its own read-only mode. Read-only-only sharing is also explicit in the generated manifest. The planner inspects exact proposed volume names, records ownership labels, and refuses conflicting or unowned volumes. Docker-managed volumes persist on scoped stop and must be included in backup planning. Host bindings come from fresh inspection during planning. A private file's `bytes` specifies minimum entropy; optional `format: "alphanumeric"` meets apps that reject punctuation, `format: "hex"` supports 64-character encryption keys from 32 random bytes, and omitted format remains base64url. `app plan` resolves or accepts one pinned digest per service and returns an exact approval; `app apply` creates private files after rendering and starts one scoped Compose project. `app handoff` reports the admin-password file, while `--show` explicitly prints a secret-bearing `.env`. `app resume` only continues before ambiguous Docker resources appear. `catalog recipes` lists validated bundled recipes; `recipeCapability.boundedApply` means the scoped CLI apply route exists, not that application acceptance passed. The Paperless-ngx route is experimental: admin login, document/OCR round-trip, restart persistence, and live deployment are unverified. Homarr's one-service route is also experimental: `app apply` prepares its encryption key and password; a separate approved `app onboard` creates and verifies the first admin and API key. Board content, integrations, widgets, Notebook, and restart persistence still require direct checks. Report Compose apply separately from application acceptance.

Immich's version 2 recipe records the official four-service topology and a distinct `api-first-admin` contract. Its bundled `immich-v3.2.2` adapter has a bounded `app plan`/`app apply` route, followed by separately approved first-admin, setup-closure, photo-round-trip, and restart-persistence checks. `recipeCapability.boundedApply` does not claim those checks passed on a new host. The older specialized `immich` CLI route remains separate.

`catalog validate` deliberately checks the unmodified source records. If you remove an app folder for a custom installation, runtime browsing and planning keep working for the remaining features, but strict validation reports dangling references until you update the affected recipes, alternatives, and Homarr registry. Use strict validation before publishing a catalog change.

Multi-service recipes give every service a short plain-language `purpose` shown in CLI plans and TUI reviews. Single-service plans carry the catalog app's purpose. The legacy `publishTargetPort` remains the required primary TCP port. Each service may declare up to eight `additionalPorts`, with IDs unique across the app unit, target port, TCP/UDP protocol, Compose purpose, and `required` flag. The owner supplies exact private host-port mappings by descriptor ID; required descriptors cannot be omitted, optional descriptors remain unpublished unless selected, and the compiler rejects unknown IDs or protocol collisions. Shared UDP publication requires an explicit private host-port choice; it is not inferred from a target port or permission for public ingress. Nothing defaults to a public bind. Multi-service recipes may add CMD-form `healthcheck`, `shmSizeBytes` (1 MiB–1 GiB), and `restart: always` when the official Compose contract requires them. Stateless services may omit mounts. Dependencies accept a service ID (started) or `{ "service": "db", "condition": "service_healthy" }` when that service declares a healthcheck. Runtime fields pass through to the scoped Compose manifest; none imply first-account acceptance.

`execution.kind: "private-daemon"` describes one continuously running service
with no published frontend and a generated native API token. Shared status and
handoff report null URL/port, never a dummy browser address. Its setup adapter
verifies authenticated container-local responses through the owned container
transport. It grants neither host networking nor enrollment; runtime devices
require the separate source-bound declaration in the Compose manifest contract.

An inspected IANA timezone may bind to `TZ` through `hostEnvironment` only when the upstream image documents that variable. A shared Compose candidate carries one UID/GID/timezone choice for its selected apps. Version 2 services use `user: "image-default"` to retain the image's runtime user, or `user: "host-selected"` when an official publisher source explicitly supports a numeric Compose user. Both modes require `imageUserEvidence`; for `host-selected`, its HTTPS `officialUrl` must be a listed app source or the recipe source. The compiler resolves `host-selected` to the chosen non-root `uid:gid` and omits image-user evidence from the numeric Compose manifest. Existing `image-default` rendering remains unchanged.

Nextcloud has an experimental four-service `app plan`/`app apply` route. Its web and cron services intentionally share one named volume. Optional `entrypoint` and `command` fields are bounded argv arrays, not shell strings. Its first-run adapter verifies the saved admin through OCS and, after a separate exact approval, creates one checkpointed WebDAV probe for readback and later restart inspection. It does not yet clean up that probe or prove cron/restart persistence. The bounded Compose route is not fresh-instance application acceptance; report that gap even when the picker permits installation.

qBittorrent has an inspect-only Hotio 5.2.3 recipe. Its WebUI stays on port 8080 inside the container and on the private host; the compiler rejects a different published host port because the pinned WebUI validates the Host authority. The owner still selects the shared `/data` bind. The source-level first-run adapter reads a temporary password only from the exact running container's current-start logs, sets the saved admin password and download paths through the WebUI API, then reads or creates and privately saves the API key. Its source fixture covers replay and lost responses; live image behavior, fresh-profile provenance, VPN safety, Arr wiring, and restart persistence remain unverified. Sonarr, Radarr, and qBittorrent use the same `media-data` bind share group when compiled into a shared project.

## Maintain Homarr coverage

Update `catalog/homarr-integrations.json` only from its official sources, preserving exact identifier case and display punctuation. It tracks the Compose-provisionable subset of Homarr integration surfaces; Docker/Kubernetes and host-platform surfaces are excluded from this app registry even when Homarr itself supports them. Every listed surface must map to exactly one `supported` app record. Keep development-only mock definitions, Search.ch widget behavior, and release-provider widget behavior outside the global integration registry. Use `bun scripts/selfhost.ts catalog homarr [--status supported|gap]` to inspect deterministic coverage; a supported integration remains independent from upstream lifecycle and automation support.

## Add a stack

Model a user goal rather than a product bundle. Each required role needs choices and one default. Optional roles remain off unless the request or preferences select them. Put cross-cutting work in `requiredSkills`, and represent risk decisions in `gates`.

Generated plans include a read-only `workflow` graph. `jobs[].needs` gives
conservative stage dependencies; `parallelGroups` names independent sibling
jobs after their shared prerequisites. With the media harness, app jobs wait
for media and Immich/Docmost also need its exact web network bound. Fresh host
inspection, resource ownership and collision checks, and exact adapter
approvals remain prerequisites. The graph authorizes no concurrent mutation.
Homarr tile/Notebook attachments wait for selected app jobs and a live check
of each app on Homarr's exact bridge. A read-back tile is not direct app
acceptance or a working integration/widget. Vaultwarden's HTTPS/account phase
gates stay explicit.
For a non-media Homarr selection, the standalone dashboard and its onboarding
precede app jobs that will join its owned bridge. Those jobs declare the
`dashboard` dependency and `homarr-onboarded` gate; a plan does not claim that
gate has been satisfied.

`taxonomy.defaultControlPlane` injects the optional, default-on Homarr role into every plan. Do not repeat Homarr in individual stack roles or dependencies. Report dedicated integration coverage separately from app-links-only coverage. Only plans selecting Homarr include its adapter and acceptance claims.

Aliases must describe genuine intent. Keep them distinct enough for deterministic longest-phrase resolution. If two stacks share an alias, catalog validation fails.

When one request directly names multiple distinct goal aliases, resolution returns `needsComposition` with ordered components. An ambiguous alias alongside a clear component remains an `unresolvedIntent` with every valid choice and `needsClarification`; planning waits for that choice. Keep app-specific and access phrases explicit enough that composition retains every clear and unresolved intent.

The taxonomy may declare an alias in `ambiguousAliases` only when at least two stacks intentionally own it. Resolution then returns every top-scoring meaning instead of choosing. `vpn` is deliberately shared by private remote access and downloader-only privacy.

Every adapter and required skill must exist in `catalog/skills.json`. Only a
`kind: adapter` record with `scope: application` may appear as an application's
`adapterSkill`; a `scope: stack` adapter is invoked directly for its complete,
documented bundle. Non-adapters use a `null` scope. Each record also declares
one install group and its exact required workflow modules. The checked
`selfhost-setup/references/install-profiles.json` manifest turns those
dependencies into the selectable `basic`, pack, and extension closures. Keep
both graphs acyclic, keep the registry sorted by exact skill ID, and conform it
to `schemas/skills.schema.json`; change the schema only when the registry shape
changes. Managed defaults must remain managed, lower-automation alternatives
are allowed and lower the generated plan's `effectiveAutomation`, and retired
applications cannot be stack choices.

`selfhost-homarr` is the Homarr application adapter. `selfhost-media` is the
selection-gated Homarr-enhanced seven-service stack adapter, not managed
support for each individual media application. It runs only when directly
requested or delegated by explicit setup/upkeep for a selected media pack;
generic personal-media plans remain guided and do not load that bundle.

## Support promotion

Promote `discovery -> guided` after primary installation and lifecycle guidance is current. Promote `guided -> managed` only after the named adapter provides versioned deterministic rendering, focused preflight, idempotent apply, acceptance checks, and rollback. Popularity and Homarr support do not promote automation.
