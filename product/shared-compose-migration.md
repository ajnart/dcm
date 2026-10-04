# One-project Compose migration

The target is one Docker Compose **project** for a selected set of container apps,
with app-scoped lifecycle actions. Existing per-app projects remain valid and are
not adopted or rewritten automatically: their Compose IDs, networks, and volume
names are different, so an in-place rename could strand data.

## Shared project contract

- A saved project owns one immutable reviewed manifest revision and one Compose
  project ID. Each app owns a named unit: its frontend plus its private helpers.
- A common `front` bridge lets Homarr reach selected frontends by app ID. Each app
  also gets its own private bridge. Helper names such as Paperless `db` and
  `broker` remain aliases only on that app's private bridge; they cannot collide
  with helpers from another app.
- Service IDs, volume names, bind paths, secret-file paths, and dependency edges
  are namespaced by app. A project's numeric UID/GID and IANA timezone are single
  choices; an extension must match the saved values. A recipe binds them only
  through upstream-supported environment
  variables; image-default users are not silently overridden.
- Extra TCP/UDP publications and shared host paths are explicit per-app
  selections. The compiler checks cross-app published-port collisions and
  requires one exact observed owner for an existing selected host path. The
  new shared-project route can instead prepare its exact internal media path
  after confirming that path is absent. A writable selected path must be
  project-owned; read-only paths may retain an external
  owner. When a read-only app such as Jellyfin and a writable Arr app use the
  exact same project-owned source, both must declare the same share group;
  their individual read-only modes remain unchanged. External or nested paths
  cannot enter that mixed-access group.
- A unit action expands to its exact service IDs. Start and stop use the existing
  selected-service approval, never whole-project `down` or volume deletion.
  Removal stops the unit and retains its data and credentials. A separate
  selected-add primitive accepts all and only newly marked services in an
  observed existing project, while preserving saved volumes.
- Adding a unit to a live project must re-observe the project, existing volume
  ownership, names, ports, networks, and the new unit's absent resources. A new
  manifest revision and exact approval must bind that evidence. An interrupted
  mutation needs a checkpoint before any retry.

`packages/cli/src/lib/shared-compose-project.ts` now compiles **validated v2
recipes** into a single candidate manifest and app-to-service map. The Compose
owner accepts per-network aliases and a bounded larger manifest. A focused
no-Docker preview of Homarr, Paperless-ngx, and Prowlarr passed manifest
validation, rendered one Compose file, and produced a selected Paperless stop
approval. This proves naming and rendering only. It does **not** establish a
shared-project apply, app setup, or a migrated existing project.
An existing-project extension preview also passed manifest validation and
produced an exact selected-add approval for Prowlarr. No Docker mutation was
performed.

The shared candidate now records one fingerprint for each selected recipe and
`prepareSharedProjectFiles` verifies the exact selected unit against that
candidate before reusing the existing private-file generator under
`secrets/<app-id>/`. It prepares only newly selected units for an extension;
retained app files are left untouched. A synthetic two-app and selected-add
fixture passed, including mismatched-input rejection before writes and
owner-only file/directory resume checks. This is a file-preparation primitive,
not live application setup. The first shared-project CLI route now saves an
exact reviewed create checkpoint. Its compiler can prepare the internal
shared `/data` tree for supported media recipes; those recipes remain
inspect-only at the CLI boundary until setup and direct acceptance are wired.
Other host paths remain out of scope. No live media installation or first-run
setup has passed through it yet.

`packages/cli/src/lib/shared-project-state.ts` now saves owner-only,
append-only manifest revisions with app-unit maps, selection fingerprints,
common UID/GID/timezone settings, and compare-and-set lifecycle checkpoints.
It rejects silent or mixed unit changes; an exact reviewed remove revision
records removed app IDs while retaining earlier revisions and app data paths.
The focused fixture covers create, changed-manifest review, exact removal,
stale writes, file ownership, and ordinary tampering. A same-owner rewrite of
the whole chain is outside this local integrity model. The state module does
not authenticate an approval, call Docker, or prove data-preserving removal
from a live Compose project.

## Gates before making this the default

1. Connect the revisioned shared-project state to the default picker and
   app-scoped lifecycle. The experimental `app shared plan|apply|status|resume`
   route covers only a new project and pre-Docker create recovery; existing
   `app.ts` checkpoints still assume one Compose project per app.
2. Connect the new selected-add primitive to checkpointed state and recovery.
   Selected-start still requires every saved volume to exist; selected-add allows
   only absent new volumes alongside verified existing ones and rejects partial
   reruns for explicit recovery. A CLI caller must save and authenticate the new
   manifest revision before invoking it.
3. Connect the new per-app private-file preparation primitive to a reviewed,
   checkpointed shared-project lifecycle. Then run existing first-run adapters
   against the shared project's saved endpoints and credentials.
4. Reconcile Homarr after app setup, reading back links, native integrations,
   widgets, and the Notebook separately. A common network is reachability, not
   successful API setup.
5. Prove new and resumed projects, scoped add/stop/start/update, interrupted
   recovery, data persistence, and an explicit migration path from old projects.

Host platforms and non-container products were removed from the app catalog;
only Compose-capable apps and bounded jobs belong there. A manifest entry is not an installer;
promotion requires a versioned recipe, deterministic first-run and credential
handling, and direct acceptance on a fresh instance.
