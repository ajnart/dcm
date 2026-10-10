# restic traps

## Pitfalls

- Restic does not schedule backups; a recurring job needs an external scheduler and overlap protection.
- A CLI container has no administrator or frontend port; the manual profile is inert on ordinary apply and its version probe does not prove backup coverage.
- The recipe's managed source and repository folders are empty staging placeholders, not selected production data or an independent off-host copy.
- A successful snapshot or repository check is not proof that application state restores; perform an isolated restore.

## Security

- Keep the repository password and backend credentials in private secret storage; retain the password independently for recovery.
- Choose and verify an off-host repository target before claiming backup coverage.
