# Render and apply contract

## Render

Render only after a `pass` plan. The target is deterministic:

```text
<project.directory>/compose.<plan-id>.yaml
```

The output directory argument must exactly match the manifest directory. The parent root must already exist. A new project creates one mode-0700 directory, or resumes with an existing empty directory after an interrupted attempt. A verified existing project requires a non-symlink directory owned by the current numeric user with no group or other permissions. The renderer creates a mode-0600 temporary file, links it to the final name without replacement, and removes the temporary name. An existing target is never overwritten.

The Compose document contains only pinned images, non-secret environment configuration, explicit ports, bind mounts, bridge networks, external opaque secret references, and conservative service settings. It has no interpolation, privilege, host namespace, devices, capabilities, or Docker socket.

## Preflight and lifecycle

`compose-lifecycle.sh` requires the manifest, exact Docker context, exact project ID, and exact deterministic rendered file for every action. Before Docker runs it:

1. Revalidates the manifest and observed ownership.
2. Requires a `pass` plan.
3. Rejects symlinks and non-regular files.
4. Re-renders in memory and requires a byte-for-byte match.
5. Requires the private project directory and every bind source to exist without symlink traversal; Docker is never allowed to create a missing bind path implicitly.
6. Runs `docker --context <context> compose --project-name <id> --file <file> config --quiet`.

`apply` additionally requires the literal `APPLY:<id>` token and runs scoped `up --detach`, which is idempotent for that project. `stop` requires `STOP:<id>` and runs scoped `stop`. The wrapper never runs `down`, removes or prunes resources, deletes volumes, discovers other projects, or prints Compose configuration.

Config success and container start are not application acceptance. Record health, API, edge, backup, VPN, and UI evidence through the owning verification capabilities.
