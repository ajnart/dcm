---
name: selfhost-compose
description: Base apply capability. Validate, plan, render, preflight, and apply one explicitly owned Docker Compose project. Use for project IDs, pinned images, private ports, bind paths, networks, opaque secret references, deterministic rendering, idempotent `up`, or scoped `stop`. Ownership, privilege, exposure, and mutation stay explicitly gated.
license: Apache-2.0; see LICENSE.txt
compatibility: Planning requires Bun 1.4.0 or newer; approved lifecycle actions require Docker with Compose v2.
---

# Self-host Compose

Own one exact Compose project. Keep validation and planning read-only; treat rendering and Docker lifecycle actions as separate boundaries.

## Workflow

1. Invoke `selfhost-host` when project paths, listeners, networks, or existing ownership have not been inspected.
2. Read [manifest-contract.md](references/manifest-contract.md) before creating input. Supply explicit observed resources and opaque `secretRefs`; optionally bind a reference to a private local file path, but never supply or read secret values.
3. Run `bun scripts/compose-project.ts validate --input project.json`, then `plan`. Resolve every `blocked` or `conflict` result before rendering.
4. Read [render-apply-contract.md](references/render-apply-contract.md). Render only the validated manifest into its exact private project directory. Rendering is atomic and refuses to overwrite a file.
5. Run the lifecycle wrapper's `preflight` action. It revalidates the manifest, verifies the rendered file byte-for-byte, checks daemon access through the exact context, and runs `docker compose config --quiet` for that exact project and file.
6. Obtain the exact `APPLY:<project>` token before `apply`, or `STOP:<project>` before `stop`. Delegate independent health and acceptance checks to `selfhost-verify` after apply.

## Commands

Resolve paths relative to this `GUIDE.md`.

```text
bun scripts/compose-project.ts validate --input project.json
bun scripts/compose-project.ts plan --input project.json
bun scripts/compose-project.ts render --input project.json --output-dir /exact/private/project

bash scripts/compose-lifecycle.sh preflight --manifest project.json --context exact-context --project exact-id --file /exact/private/project/compose.<plan-id>.yaml
bash scripts/compose-lifecycle.sh apply --manifest project.json --context exact-context --project exact-id --file /exact/private/project/compose.<plan-id>.yaml --approval APPLY:exact-id
bash scripts/compose-lifecycle.sh stop --manifest project.json --context exact-context --project exact-id --file /exact/private/project/compose.<plan-id>.yaml --approval STOP:exact-id
```

Use input files, not process arguments. The planner performs no Docker or network action. `pass` means the manifest is internally consistent with the supplied observations; it does not mean the host was changed or verified.

## Hard boundaries

- Require a normalized Docker context, project ID, owner, root, directory, and `new` or `verified-existing` ownership evidence.
- Require explicit, non-floating image references. Reject `latest`, interpolation, host networking, privileged mode, device/capability expansion, Docker socket mounts, and public protected ports.
- Keep all resource claims explicit. Reject overlapping bind paths, colliding ports, competing networks, or reuse whose observed owner is missing or different.
- Represent secrets as opaque references, optionally bound to validated private local files. Keep payloads out of JSON, Compose, commands, logs, and reports.
- Render only the deterministic minimal Compose document. Never overwrite a rendered file or follow a project-directory symlink.
- Target one project and one verified file. Never run broad `docker` commands, `compose down`, `down --volumes`, prune, or volume deletion.

## Completion criteria

Complete planning only when ownership, paths, ports, images, networks, observations, and approvals are explicit and the plan is `pass`. Complete apply only after the exact approval token, successful config preflight, scoped idempotent `up`, and independent acceptance evidence. Never infer acceptance from container liveness.
