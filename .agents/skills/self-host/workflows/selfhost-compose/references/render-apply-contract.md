# Render and apply contract

## Render

Render only after a `pass` plan. The target is deterministic:

```text
<project.directory>/compose.<plan-id>.yaml
```

The output directory argument must exactly match the manifest directory. The parent root must already exist. A new project creates one mode-0700 directory, or resumes with an existing empty directory after an interrupted attempt. A verified existing project requires a non-symlink directory owned by the current numeric user with no group or other permissions. The renderer creates a mode-0600 temporary file, links it to the final name without replacement, and removes the temporary name. An existing target is never overwritten.

The Compose document contains only pinned images, non-secret environment configuration, argv-form command and entrypoint overrides, CMD-form healthchecks, validated service dependencies, explicit ports, bind mounts, project-owned local named volumes, bridge networks, declared secrets, and conservative service settings. Named volumes render with explicit project-scoped names and `io.selfhost.project`/`io.selfhost.volume` labels; Compose adds its project/volume labels. A volume shared by distinct services under the exact same ownership contract is declared once. A selected subnet on a new network renders as `ipam.config[].subnet`; omission leaves Docker's default address-pool allocation unchanged. A secret without `filePath` renders as an external opaque reference. A local binding renders the absolute source under the project's private `secrets/` directory with Compose `file:` syntax; its payload is never read or emitted. An evidenced `image-default` user omits the Compose `user` override and is flagged in the plan. An evidenced rootless-only `0:0` user remains explicit and is also flagged. The document has no shell-form runtime strings, interpolation, privilege, host namespace, devices, capabilities, or Docker socket.

## Preflight and lifecycle

The fixed, source-bound tunnel resource profile is the only exception to the
default document's device/capability restriction. Privileged mode, host
namespaces, arbitrary capabilities/devices and Docker sockets remain forbidden.

An optional private `env_file` is rendered as a path only. Preflight applies the same owner, mode-0600, regular-file, size, and no-symlink checks used for local secret files. Its contents are not printed or included in the manifest or Compose document. Unlike Compose secrets, environment values can be exposed through container inspection to users with Docker access.

`compose-lifecycle.sh` requires the manifest, exact Docker context, exact project ID, and exact deterministic rendered file for every action. Before Docker runs it:

1. Revalidates the manifest and observed ownership.
2. Requires a `pass` plan.
3. Rejects symlinks and non-regular files.
4. Re-renders in memory and requires a byte-for-byte match.
5. Requires the private project directory and every bind source to exist without symlink traversal; Docker is never allowed to create a missing bind path implicitly.
6. Requires every secret to have a local `filePath`, then verifies each source is a current-user-owned mode-0600 regular file, 1–65536 bytes, with no symlink traversal or hard links. It inspects metadata only. External references require a separately owned external secret platform and are unsupported by this local lifecycle.
7. Checks daemon access with an allowlisted `docker --context <context> info` field, suppressing payload output. The exact `rootless` context uses `{{json .SecurityOptions}}` and must report rootless mode; other contexts use `{{.ServerVersion}}`. Failure or a rootless-mode mismatch stops before Compose and reports the selected context; no permission changes or implicit sudo are attempted.
8. For each declared named volume, queries only its exact name and allowlisted driver/ownership labels. An absent new volume may be created only on initial apply; saved-project up and selected start pass `--require-existing-volumes true`, refusing to replace a missing volume with empty data. An existing volume must have the exact local driver and all ownership labels. A verified-existing volume must exist. Ambiguity or query failure stops before Compose.
9. Runs `docker --context <context> compose --project-name <id> --file <file> config --quiet`.

Compose mounts each explicitly granted local source at `/run/secrets/<target>`. Docker Compose implements local file sources with bind mounts, so Compose-level `uid`, `gid`, and `mode` remapping is not used here; the lifecycle enforces the host file's ownership and mode before Docker runs.

Source: [Docker Compose secrets](https://docs.docker.com/compose/how-tos/use-secrets/) and the [Compose secrets specification](https://docs.docker.com/reference/compose-file/secrets/).

Runtime field sources: [Compose services reference](https://docs.docker.com/reference/compose-file/services/) and [startup order](https://docs.docker.com/compose/how-tos/startup-order/).

`apply` additionally requires the literal `APPLY:<id>` token for ordinary manifests. A manifest with source-bound `runtimeResources` instead requires `APPLY:<id>:<full-canonical-manifest-sha256>` as shown in the plan; bare legacy approval cannot grant network device/capability authority. Shared and selected approvals already bind the full manifest, including runtime-resource source identities. Before Compose preflight or any startup, the lifecycle wrapper verifies exact TUN character-device metadata and selected local system Unix daemon endpoint/security metadata. The fixed tunnel profile alone renders `cap_add: [NET_ADMIN]` and `/dev/net/tun:/dev/net/tun:rwm`; no generic privilege/device flags are accepted. Apply runs scoped `up --detach`, which is idempotent for that project. `stop` requires `STOP:<id>` and runs scoped `stop`. The wrapper never runs `down`, prunes resources, deletes volumes, discovers other projects, or prints Compose configuration. Container removal requires the separately reviewed selected-remove boundary below.

Config success and container start are not application acceptance. Record health, API, edge, backup, VPN, and UI evidence through the owning verification capabilities.

Source-bound `ownerDirectory` and Docker CLI TLS claims also require the exact
full-manifest apply token, never legacy bare approval. The CLI wrapper obtains
the expected token from the canonical owner instead of maintaining a second
token policy. Before any selected or ordinary startup, the lowest shared
pre-start gate verifies the saved directory claim, actual numeric owner,
current approved TLS daemon identity and matching selected local daemon ID.
Setup exposes only the same no-argument owner check, not a caller proof flag.

Manual jobs use only `profiles: ["self-host-manual"]`. The lifecycle wrapper
clears ambient `COMPOSE_PROFILES` and explicitly targets only automatic service
IDs for ordinary apply. A manual-job-only project is prepared without any `up`.
Selected add binds all new services but starts only automatic ones; manual jobs
remain prepared. Selected start/recreate cannot name a manual job. Stop does not
execute jobs. Profile configuration is not authority to run a backup or other
operation; no ordinary lifecycle action enables the manual profile.

## Explicit fixed version probes

`selected-plan --operation probe --services EXACT_ID` accepts one manual job
with a validated `manualProbe`. Its separate `SELECTED-PROBE` approval binds
the full manifest, fixed command, image, evidence, context and selected service.
`compose-lifecycle.sh selected-probe` requires that exact token and performs the
normal ownership, file, daemon and Compose preflight before running only the
fixed command with `run --rm --no-deps --entrypoint FIXED_BINARY`. Overriding
the image entrypoint avoids starting cron or bootstrap logic. There are no raw
command arguments accepted from the caller, dependencies do not start, and
ambient profiles remain disabled. Execution is bounded to 60 seconds and 1 MiB
of captured output; stdout/stderr are withheld from ordinary reports. A failure
or timeout is an unknown outcome requiring inspection, not automatic replay.
Success reports exit metadata only: it does not verify a backup, repository,
token scope, scheduled job or isolated restore. The CLI owner exposes
`selectedPlan(plan, "probe", services)` and `probeSelected(plan, services, approval)`.

## Selected services for isolated restore

`compose-project.ts selected-plan --input FILE --services database,redis --operation start`
is read-only and returns a separate `SELECTED-START:<project>:<sha256>` approval.
Selection must name unique exact manifest service IDs. The fingerprint binds the
operation, sorted selection, Docker context, project, full canonical manifest
SHA-256, plan ID and rendered target. Existing plan IDs and render filenames
retain their 16-hex prefix; selected approvals bind all 64 hex characters;
ordinary `APPLY`/`STOP` tokens cannot authorize it.

`compose-lifecycle.sh selected-start` takes the usual exact manifest/context/project/file,
plus `--services database,redis --approval EXACT_SELECTION_TOKEN`. It performs the
same full lifecycle validation, daemon and config preflight, then runs scoped
`up --detach --no-deps` for only those services. This allows database import before
the app starts; it neither proves database recovery nor prevents an already-running
unselected app from writing. The restore owner must establish that isolation first.
`selected-stop` uses an independently planned `--operation stop` token and stops
only the selected services, retaining resources and data.

`selected-add` is a separate extension operation for a verified-existing project.
The manifest must mark every retained service `ownership: "verified-existing"`
and every new service `ownership: "new"`; the selection must name **all and only**
the new services. Its `SELECTED-ADD` fingerprint binds the full manifest and
selection. The wrapper allows an absent, newly declared named volume alongside
verified existing volumes, while refusing a missing saved volume or an already
present new volume. It checks that no selected service already has a Compose
container, then runs only those service IDs with `up --detach --no-deps`.
An interrupted add with any new container or volume requires observation and
resume planning; rerunning the same add is intentionally refused. This is a
scoped mutation primitive, not an app-install flow or acceptance result.

The CLI owner exposes `selectedPlan(plan, operation, services)`,
`startSelected(plan, services, approval)`, `stopSelected(plan, services, approval)`,
and `addSelected(plan, services, approval)`.
No ordinary apply/stop scope is changed; no dependency startup, teardown, privilege,
backup or application acceptance is granted by this seam.

## Data-preserving selected container removal

`selected-plan --operation remove --services EXACT_IDS` returns a separate
`SELECTED-REMOVE` approval bound to the full original immutable manifest and
exact service selection. `selected-remove` performs ordinary file/config and
volume-ownership preflight, then inspects only selected project/service label
matches. Each existing container must match the original Compose file, working
directory, project, service and non-oneoff label. It stops only selected services,
rechecks ownership, and runs `compose rm --force` only for those services, without
`--volumes`. It verifies selected container absence afterward. Bind data, named
volumes, networks and private credentials are retained. Absent containers are
allowed; ambiguous ownership or unknown outcome requires inspection, not replay.

The shared CLI exposes `app shared remove --app ID ... --project-root ABS
--project-id ID --json` for read-only review and adds `--apply --approval
SHARED-REMOVE:ID:DIGEST` for approved mutation (`--approve` is an alias). The
shared approval additionally binds the saved revision, retained inventory and
all original Compose groups. The owner checkpoints before ambiguous mutations;
failure leaves `inspect-required`, not success. Retained dependency and HTTPS
route breakage is blocked. An interrupted `reviewed` removal before its attempted
checkpoint can be reviewed and applied again with the same exact app selection
and original saved-owner approval. Recovery revalidates the original Compose
groups and retained inventory; attempted or uncertain removals cannot replay.
Removing the final app is unsupported: stop the
project instead; full owner retirement is not implemented. Successful removal
reports `removed-unverified`, not application acceptance or complete data deletion.

Removal checks the bounded metadata of matching files in the owner-only
`service-links` directory for supported retained-source/removed-target pairs.
Saved-link-history presence blocks removal until separately reviewed link
retirement exists; unsafe matching metadata fails closed. This is neither
checkpoint-payload parsing nor proof that the connection currently works.
An eligible pair without saved history does not block removal by itself.
Removed app IDs stay reserved in the validated journal: ordinary `add` rejects
them before recipe/image inspection, secret preparation, rendering or Docker.
For eligible standard apps, `app shared reinstall` separately reviews exact
historical restoration and uses the original file's selected-start approval.
It verifies preserved resources and retains account checkpoints; no secret
preparation or first-run setup executes. Special authority/configuration cases
remain blocked. See the [shared-project CLI](../../selfhost-setup/references/shared-project-cli.md)
for its review/apply contract. Ordinary add's removal-history barrier stays intact.

Daemon access source: [Docker system info](https://docs.docker.com/reference/cli/docker/system/info/). Config parsing alone does not contact the daemon and is not proof that apply can reach it.
