# Preference contract

Preferences record user choices, not discovered host truth and not secrets. An explicit absolute `--project-root` derives `<project>/.selfhost/preferences.json`; an explicit absolute `--path` selects another file. Planning without either source uses an empty preference set, while preference commands require one. Installed skill paths and filesystem roots are rejected. Each choice is stored as `{value, source, updatedAt}`; `source` is `chosen` or `imported`.

Do not use preferences as a deployment ledger. Returning-project intent and
checkpoint IDs live separately in `.selfhost/project.json`; current host facts
still come from a fresh inspection.

Allowed fields cover onboarding experience (`new` or `advanced`), platform,
locale/timezone, project naming, logical config/data/media/download/backup
paths, UID/GID, Docker network, host alias, ingress mode/owner/domain, VPN
mode/scope, backup cadence, hardware acceleration, and UI theme. The schema is
`catalog/schemas/preferences.schema.json`. A missing `onboarding.experience`
means setup must ask once and save the confirmed answer; no separate onboarding
status is needed.

The CLI writes a private temporary file, flushes it, atomically renames it, and sets mode `0600`. Its project-local state directory is created with mode `0700`. Preference and project-state writes share one private per-project update lock, so concurrent writes fail clearly instead of overwriting one another. It rejects linked/special paths and broader preference permissions. It rejects secret-like field names and values before serialization and never echoes the rejected input.

The first project-root write creates `.selfhost/.gitignore` containing only
`*`, preventing the local preferences, project record, temporary files, and
update lock from appearing as commit candidates in an installed target
repository. An explicit `--path` keeps its existing parent permissions and
ignore policy; the caller owns that location.

Prefer logical path choices over generated service paths. Resolve platform-specific host paths during inspection and show them in a plan before creation. A missing preference file means no choices have been confirmed.
