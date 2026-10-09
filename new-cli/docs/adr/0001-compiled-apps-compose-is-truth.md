# Apps are compiled Go; Compose files decide what runs

Catalog Apps are Go code compiled into the `self-host` binary, sharing one helpers package for HTTP, waits, container exec, secrets and config edits. We rejected bash setup scripts and an embedded JS engine: one typed language keeps Setup testable and the helpers in one place, at the cost that nobody can add automatic Setup without a new release. Agents add off-catalog apps by writing `apps/<id>/compose.yml` themselves; the root `compose.yml` only `include:`s every app folder, so start, stop, update and backup work from Compose files alone, and `state.json`/`secrets.env` are just the credentials and step-result record.

## Amendment: `up` removes orphaned Project containers

`up` runs `compose up` with `--remove-orphans`: a container of the Project that is no longer in its rendered Compose files is removed, never volumes. An Unmanaged app is never an orphan, because its own `compose.yml` is part of the Project and is rendered with the rest.
