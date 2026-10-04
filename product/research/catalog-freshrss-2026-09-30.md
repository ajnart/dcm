# FreshRSS 1.30.0 shared first-run boundary

The pinned Compose recipe can start FreshRSS privately, but it cannot yet produce a verified administrator through the shared adapter contract.

## Source-backed facts

- The [versioned CLI manual](https://github.com/FreshRSS/FreshRSS/blob/1.30.0/cli/README.md) documents `prepare.php`, then `do-install.php --default-user admin --auth-type form --db-type sqlite`, followed by `create-user.php --user admin --password ...`. `do-install.php` explicitly does **not** create the user.
- The [versioned Docker entrypoint](https://github.com/FreshRSS/FreshRSS/blob/1.30.0/Docker/entrypoint.sh) passes `FRESHRSS_USER` to `create-user.php` as command arguments. That does not keep the password out of process argv.
- The pinned [create-user source](https://github.com/FreshRSS/FreshRSS/blob/1.30.0/cli/create-user.php) uses the [CLI option parser](https://github.com/FreshRSS/FreshRSS/blob/1.30.0/cli/CliOptionsParser.php), which reads PHP's real process arguments. Private stdin to the exact container does not change that contract. The generated `admin-password` file is a handoff reference, not evidence that FreshRSS accepted its value.
- The CLI manual documents `reconfigure-user.php --value-stdin` for an **existing** user configuration attribute. It does not document a stdin password option for `create-user.php` or a first-user API.
- The [user management guide](https://freshrss.github.io/FreshRSS/en/admins/12_User_management.html) describes browser administrator and registration forms, not a stable private automation endpoint. The [access-control guide](https://freshrss.github.io/FreshRSS/en/admins/09_AccessControl.html) says form authentication uses JavaScript. An HTTP form payload or login success marker must be derived from pinned source and verified before it becomes an adapter contract.
- The CLI manual says `--api-enabled` permits the mobile API, while users need separate API passwords. Neither is implied by creating the first form-login administrator.

## Decision

Keep `manual-first-admin`, guided automation, and no `setup.ts`. The shared container transport forbids secrets in argv. Replaying `create-user.php` with the generated password would violate that boundary; creating a passwordless user before a stdin-based configuration update would introduce an unaccepted interim state. A custom PHP wrapper around the CLI or internal model is not a documented upstream interface. Compose liveness or HTTP 200 must not be reported as ready.

An eventual adapter needs a pinned, proven secret-safe first-user operation; exact-owner checkpoint before its write; inspection that distinguishes absent, owned, and foreign installations; authentication using the saved password; and a restart-persistence check. Mobile API credentials require a separate explicit request, separate secret, and independent verification.
