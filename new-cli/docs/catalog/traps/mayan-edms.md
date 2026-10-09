# Mayan EDMS traps

## Pitfalls

- Auxiliary Compose services use App-owned names: `mayan-edms-postgresql`, `mayan-edms-rabbitmq`, `mayan-edms-redis`. Keep these names in connection settings and dependencies; persistent data paths stay unchanged.
- Workflow complexity is substantially higher than a PDF toolbox.
- The upstream defaults contain database, broker, and Redis passwords. The shared candidate generates private credentials and derives the required configuration without exposing passwords in command arguments.
- The pinned autoadmin implementation displays even a supplied initial password on the login page. Keep bootstrap private; setup authenticates the saved owner before rehashing that same password to clear the display, then verifies it is gone. Never reset an unknown owner or repeat an ambiguous token request.
- The image starts as root for its documented initialization, then runs application processes as mayan. Redis uses the current host UID to read the owner-only generated configuration; verify this identity and file readability on the intended Docker context before live acceptance.

## Security

- Define document permissions and recovery before ingestion.
