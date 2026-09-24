# Render and apply contract

## Render

Render only after a `pass` plan. The target is deterministic:

```text
<project.directory>/compose.<plan-id>.yaml
```

The output directory argument must exactly match the manifest directory. The parent root must already exist. A new project creates one mode-0700 directory, or resumes with an existing empty directory after an interrupted attempt. A verified existing project requires a non-symlink directory owned by the current numeric user with no group or other permissions. The renderer creates a mode-0600 temporary file, links it to the final name without replacement, and removes the temporary name. An existing target is never overwritten.

The Compose document contains only pinned images, non-secret environment configuration, argv-form command and entrypoint overrides, CMD-form healthchecks, validated service dependencies, explicit ports, bind mounts, bridge networks, declared secrets, and conservative service settings. A secret without `filePath` renders as an external opaque reference. A local binding renders the absolute source under the project's private `secrets/` directory with Compose `file:` syntax; its payload is never read or emitted. An evidenced `image-default` user omits the Compose `user` override and is flagged in the plan. The document has no shell-form runtime strings, interpolation, privilege, host namespace, devices, capabilities, or Docker socket.

## Preflight and lifecycle

`compose-lifecycle.sh` requires the manifest, exact Docker context, exact project ID, and exact deterministic rendered file for every action. Before Docker runs it:

1. Revalidates the manifest and observed ownership.
2. Requires a `pass` plan.
3. Rejects symlinks and non-regular files.
4. Re-renders in memory and requires a byte-for-byte match.
5. Requires the private project directory and every bind source to exist without symlink traversal; Docker is never allowed to create a missing bind path implicitly.
6. Requires every secret to have a local `filePath`, then verifies each source is a current-user-owned mode-0600 regular file, 1–65536 bytes, with no symlink traversal or hard links. It inspects metadata only. External references require a separately owned external secret platform and are unsupported by this local lifecycle.
7. Checks daemon access with `docker --context <context> info --format '{{.ServerVersion}}'`, suppressing payload output. Failure stops before Compose and reports the selected context; no permission changes or implicit sudo are attempted.
8. Runs `docker --context <context> compose --project-name <id> --file <file> config --quiet`.

Compose mounts each explicitly granted local source at `/run/secrets/<target>`. Docker Compose implements local file sources with bind mounts, so Compose-level `uid`, `gid`, and `mode` remapping is not used here; the lifecycle enforces the host file's ownership and mode before Docker runs.

Source: [Docker Compose secrets](https://docs.docker.com/compose/how-tos/use-secrets/) and the [Compose secrets specification](https://docs.docker.com/reference/compose-file/secrets/).

Runtime field sources: [Compose services reference](https://docs.docker.com/reference/compose-file/services/) and [startup order](https://docs.docker.com/compose/how-tos/startup-order/).

`apply` additionally requires the literal `APPLY:<id>` token and runs scoped `up --detach`, which is idempotent for that project. `stop` requires `STOP:<id>` and runs scoped `stop`. The wrapper never runs `down`, removes or prunes resources, deletes volumes, discovers other projects, or prints Compose configuration.

Config success and container start are not application acceptance. Record health, API, edge, backup, VPN, and UI evidence through the owning verification capabilities.

Daemon access source: [Docker system info](https://docs.docker.com/reference/cli/docker/system/info/). Config parsing alone does not contact the daemon and is not proof that apply can reach it.
