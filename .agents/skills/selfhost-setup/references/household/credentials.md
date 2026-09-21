# Household credential boundary

Use `scripts/household-credentials.ts` after the plan selects one or more of the
five supported household services and before rendering their Compose projects.
This store is independent from the media session. When Vaultwarden is selected,
its generated application password is the initial Vaultwarden master password;
it remains unique from every other application and database password.

```text
bun scripts/household-credentials.ts create \
  --project-root /absolute/project --run-id household-run \
  --username selected-user --email owner@example.test \
  --service audiobookshelf --service immich --service navidrome \
  --service nextcloud --service vaultwarden

bun scripts/household-credentials.ts status \
  --project-root /absolute/project --run-id household-run

bun scripts/household-credentials.ts materialize \
  --project-root /absolute/project --run-id household-run \
  --service immich --field databasePassword \
  --project-directory /absolute/private/compose-project
```

`create` requires a non-empty, duplicate-free subset of `audiobookshelf`,
`immich`, `navidrome`, `nextcloud`, and `vaultwarden`, plus the user's exact
ASCII username. It requires an explicitly provided email when Immich or
Vaultwarden is selected; never derive an email from the username. It creates
unique application passwords and separate database passwords for selected
Immich and Nextcloud services in
`.selfhost/household/.sessions/<run>/artifacts/private-handoff.json`. The
handoff and materialized secrets are owner-only mode `0600`; their parent
directories are mode `0700`. Creation is exclusive and never resets a run.

`materialize` copies one managed value into the fixed `secrets/` path of an
existing owner-only Compose project. Pass that returned path as the local
`filePath` of an opaque `secretRef`. Repetition succeeds only when the existing
private file contains the same managed value. CLI output contains paths,
status, service IDs, and pending state only.

The handoff declares every service `pending` and the run `not-verified`.
Credential generation and materialization are not provisioning or acceptance
evidence. API-key fields remain `null` until an application-specific onboarding
owner captures them through its private boundary.

For browser-only onboarding, use `scripts/household-browser-credentials.ts`.
Its `fill` command accepts repeated `--input FIELD=@eN` references for selected
`username`, `email`, and password fields supported by that service. Its
`capture-api-key` command supports Immich's `/user-settings` page with an
enabled, readonly text field identified as an API key or token. It also supports
Audiobookshelf v2.36.1 at `/config/api-keys`: omit `--selector` while the
one-time creation dialog is visible, and the helper reads only its fixed
readonly **API Key** field.
Both commands derive the fixed
`selfhost-household-<run>` browser session, require the current page to match an
explicit private loopback, RFC1918/ULA, `.localhost`, or `.home.arpa` origin,
and pass secret values only through the child process's standard input. They do
not take snapshots or screenshots. API-key capture atomically updates the
private handoff to `filled`; this records only that the value was filled into
the handoff. Status output reports that stored credential state; it does not
mean that the key works, the service was provisioned, or the application passed
acceptance.

```text
bun scripts/household-browser-credentials.ts fill \
  --project-root /absolute/project --run-id household-run \
  --service immich --origin http://127.0.0.1:2283 \
  --input username=@e1 --input email=@e2 \
  --input password=@e3 --input password=@e4

bun scripts/household-browser-credentials.ts capture-api-key \
  --project-root /absolute/project --run-id household-run \
  --service immich --origin http://127.0.0.1:2283 --selector @e7

bun scripts/household-browser-credentials.ts capture-api-key \
  --project-root /absolute/project --run-id household-run \
  --service audiobookshelf --origin http://127.0.0.1:13378
```
