# BookStack traps

## Pitfalls

- Auxiliary Compose services use App-owned names: `bookstack-db`. Keep these names in connection settings and dependencies; persistent data paths stay unchanged.
- Database and uploaded files must be backed up consistently.
- The first-admin adapter uses bookstack:create-admin --initial --generate-password, capturing only its success stdout into the owner-only password file. If the database changes but that file is not saved, the result is ambiguous: never rerun the initial command or present the pre-generated placeholder as a working credential; recover through a separately approved private route.
- The pinned v26.05.3 own-account form creates one API token inheriting the saved administrator's permissions, expiring 2099-01-01. Shared setup separately approves creation and the once-returned secret read, privately saves Token ID:Secret, and verifies the exact owner through the API. Interrupted creation or missing secret output requires inspection, never another token. No database extraction is used; live login, content, restart, and restore acceptance remain unverified.

## Security

- The packaged container starts with publicly known admin@admin.com/password credentials; replace them before any exposure.
- Keep APP_URL fixed to the reviewed origin and review registration, public access, roles, attachments, and SSO before exposure.
