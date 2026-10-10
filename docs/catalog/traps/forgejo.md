# Forgejo traps

## Pitfalls

- Backing up repositories without database and configuration can lose metadata.
- The pinned CLI privately generates the first administrator password. Setup separately creates and privately saves one read:user API token, verifies its owner, ID and exact scopes, and migrates owned administrator-only checkpoints. Missing one-time password/token output forbids replay. This read-only user token does not grant repository access or prove Git operation; Homarr integration remains unsupported. Token inventories beyond the bounded first page require inspection.

## Security

- Protect SSH/HTTP ingress, signing keys, webhooks, and repository backups.
