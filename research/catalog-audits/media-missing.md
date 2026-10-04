# Missing media app audit

Checked 2026-10-03. Primary-source research and synthetic fixtures only. No
Docker start, existing-container edit, media/indexer request, archival job,
socket mount, or added host privilege was performed.

## Tracearr: source-backed recipe and first-owner adapter

The [v2.6.0 release](https://github.com/connorgallopo/Tracearr/releases/tag/v2.6.0)
is current. Its [release workflow](https://github.com/connorgallopo/Tracearr/blob/v2.6.0/.github/workflows/release.yml)
publishes semver image tags without the `v` prefix; runtime build metadata
retains it. The catalog now selects `:2.6.0`, not `:latest`. Registry availability
and image digests must still be resolved at planning; source publication policy
is not a registry pull or live image proof.

The [official pinned Compose](https://github.com/connorgallopo/Tracearr/blob/v2.6.0/docker/examples/docker-compose.pg18.yml)
requires TimescaleDB HA pg18.4-ts2.29.1, Redis 8, a 512 MiB shared-memory area,
and nofile soft/hard limits of 65536. The recipe uses the shared bounded nofile
primitive, named volumes and no published dependency ports. `pg_isready -U
tracearr` becomes direct CMD argv: the official shell command contains no shell
expansion. PostgreSQL 18 remains experimental and **fresh-volume-only**.
The [image Dockerfile](https://github.com/connorgallopo/Tracearr/blob/v2.6.0/docker/Dockerfile)
sets non-root `tracearr`; do not replace it with a guessed host UID.

The [setup route](https://github.com/connorgallopo/Tracearr/blob/v2.6.0/apps/server/src/routes/setup.ts)
provides the public ownerless discriminator. The [authentication configuration](https://github.com/connorgallopo/Tracearr/blob/v2.6.0/apps/server/src/lib/auth.ts)
and [guards](https://github.com/connorgallopo/Tracearr/blob/v2.6.0/apps/server/src/lib/authGuards.ts)
force the first signup to role `owner` and forbid signup once an owner exists.
The [shipped login page](https://github.com/connorgallopo/Tracearr/blob/v2.6.0/apps/web/src/pages/Login.tsx)
establishes JSON signup fields `name`, `username`, `email`, `password` and the
username/password sign-in path. Email is a required, reviewed non-secret setup
input, saved before signup; changing it on resume is refused.

The adapter checkpoints before signup, creates `admin` only on an ownerless,
claim-code-free instance, then proves fresh password login and exact owner
identity with [`auth/me`](https://github.com/connorgallopo/Tracearr/blob/v2.6.0/apps/server/src/routes/auth/session.ts).
It uses a Better Auth Bearer session saved in the exact owner's mode-0600
session facility, bound to a digest of the username, email and password. It
rechecks `auth/me` before reusing that session, preserving the exact
Authorization-bound approval across CLI invocations. Only a definite 401
clears it; network uncertainty, malformed identity and other failures retain
it and stop. This session is not a persistent API-key substitute.
Upstream enables its Bearer plugin; its same-host origin policy and
`useSecureCookies: false` also support private HTTP. No session token is placed
in checkpoints or ordinary output.

The [settings routes](https://github.com/connorgallopo/Tracearr/blob/v2.6.0/apps/server/src/routes/settings.ts)
provide retrievable `trr_pub_` keys. The adapter creates only an absent first
key, never rotates an existing uncheckpointed key, recovers an ambiguous create
through inventory, saves it privately, and proves Bearer access to the
[public health route](https://github.com/connorgallopo/Tracearr/blob/v2.6.0/apps/server/src/routes/public.ts).
`inspect` proves the saved key and ready pinned server; rerunning `firstRun`
also proves the saved session's exact current owner. A new approved password
login is required after definitive session rejection. Media-server enrollment remains separate.

Validation: adapter build; focused setup fixture (fresh/replay, lost signup/key
responses, no readback means no replay, existing owner/key refusal, wrong role,
version, claim-code and missing email rejection, private session retention on
uncertain reads and clearing only on 401); real-transport deferred fixture
(new facilities per invocation, identical pending-key approval hashes, one
signup/login/key creation, mode-0600 session, no one-time-write replay);
focused recipe compiler
fixture (private primary port, private dependencies, nofile, shared memory,
CMD healthcheck); `catalog recipe tracearr` passes. No fresh-image account,
restart, media-server or Homarr request was tested. Homarr's catalog mapping
remains exactly `Tracearr`; mapping is not tested integration acceptance.

## Emby: deployment candidate, first-account gap

The [vendor image instructions](https://hub.docker.com/r/emby/embyserver)
document `/config`, media mounts and port 8096. The existing deployment-only recipe
pins 4.10.0.40, uses a private bridge, preserves image-user defaults and makes
the selected media mount read-only. It grants no GPU/device/host-network
access. Default UID 2 media readability needs an isolated check; do not change
the host directory permissions automatically.

The existing [pinned client audit](../../.agents/skills/self-host/workflows/selfhost/references/catalog/apps/emby/BOOTSTRAP.md)
establishes startup and persistent-key request names, not server-side initial
state, authorization or response contracts. The refreshed [public system-info
reference](https://dev.emby.media/reference/RestAPI/SystemService/getSystemInfoPublic.html)
still lacks a startup-completion field. A replay-safe adapter needs a sourced
read-only untouched/partial/completed discriminator **before** the potentially
mutating `GET Startup/User`, independent wizard-completion readback, exact
admin-policy and key-inventory response contracts. Copying Jellyfin's DTO is
incorrect. No dummy `setup.ts` is added; the generated password remains a
placeholder, never proof of an installed owner. Recipe inspection and compiler
fixture pass; first account, key and live deployment remain unresolved.

## ArchiveTeam Warrior: external-write and image-provenance gap

The [documented environment](https://wiki.archiveteam.org/index.php/ArchiveTeam_Warrior/Docker_environment_variables)
can seed HTTP username/password, not an administrator or durable API key.
The [pinned startup](https://github.com/ArchiveTeam/warrior-dockerfile/blob/7682e0a0f35266fd1d31d4efe172f495c4ce10f3/start.py)
loads config if possible, otherwise seeds it once, then invokes `run-warrior3`
with the external Warrior HQ URL. The [runner](https://github.com/ArchiveTeam/seesaw-kit/blob/699b0d215768c2208b5b48844c9f0f75bd6a1cbc/seesaw/warrior.py)
registers/updates HQ independent of selecting an archival project. Thus
`SELECTED_PROJECT=none` is not an offline bootstrap, and current approval for
no downloads/media/indexers does not authorize those external writes.

The [pinned Dockerfile](https://github.com/ArchiveTeam/warrior-dockerfile/blob/7682e0a0f35266fd1d31d4efe172f495c4ce10f3/Dockerfile)
has a version label but mutable base images and an unpinned cloned runner; a
matching published fixed tag and source-to-image runner provenance remain
unverified. A source-backed fail-closed egress boundary plus reviewed startup
and inert authenticated readback would enable an isolated credential test.
Do not invent a recipe tag, API key, inert startup flag, or dummy adapter.

## Exact future isolated test proposal (not approved or applied)

Tracearr only: new disposable Compose project, four fresh named volumes,
three digest-resolved images from the recipe, loopback TCP 19300 -> 3000,
no devices, socket, privileged mode, host networking or media mounts. Review
nofile 65536 and 512 MiB shared memory explicitly. Require owner email and
generated private credentials; no server enrollment, imported history,
notification destination or archival job. Test fresh setup, same-owner replay,
API-key readback and scoped restart. Upstream startup includes background
release checks, so disclose its ordinary outbound traffic before approval.
Remove only that exact project after separately approved cleanup; named data
volumes remain unless their exact deletion is approved. Emby and Warrior need
the state/provenance boundaries above resolved before a first-account trial.
