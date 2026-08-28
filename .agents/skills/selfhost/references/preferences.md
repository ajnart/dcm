# Preference contract

Preferences record user choices, not discovered host truth and not secrets. The default location is `.selfhost/preferences.json` in the current project. Each choice is stored as `{value, source, updatedAt}`; `source` is `chosen` or `imported`.

Allowed fields cover platform, locale/timezone, project naming, logical config/data/media/download/backup paths, UID/GID, Docker network, host alias, ingress mode/owner/domain, VPN mode/scope, backup cadence, hardware acceleration, and UI theme. The schema is `catalog/schemas/preferences.schema.json`.

The CLI writes a private temporary file, flushes it, atomically renames it, and sets mode `0600`. Its project-local state directory is created with mode `0700`. It rejects linked/special paths and broader preference permissions. It rejects secret-like field names and values before serialization and never echoes the rejected input.

Prefer logical path choices over generated service paths. Resolve platform-specific host paths during inspection and show them in a plan before creation. A missing preference file means no choices have been confirmed.
