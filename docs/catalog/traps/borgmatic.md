# Borgmatic traps

## Pitfalls

- The publisher documents daily scheduling by default and CRON=false to disable it; do not start a backup schedule before separate source, destination, and write approval.
- The recipe's managed source and repository folders are empty staging placeholders, not selected production data or an independent off-host copy.
- Hooks must fail closed when a database dump or quiesce step fails; a successful archive still requires an isolated restore drill.

## Security

- Protect the Borg repository passphrase, keyfiles, and any remote SSH key outside ordinary reports and logs.
- Select backup sources and a repository destination only after their exact ownership is known; do not mount the Docker socket by default.
