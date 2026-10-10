# Dockge traps

## Pitfalls

- The official Compose mount gives Dockge host Docker control; importing or creating stacks needs explicit ownership and upgrade boundaries.
- The stacks directory must be an absolute bind with identical host and container paths.
- Pinned 1.5.0 setup and login use internal Socket.IO events, not a stable HTTP first-admin or durable API-key contract. A running UI without approved daemon authority does not satisfy Compose-management acceptance.

## Security

- Protect the UI and treat Docker access as host control; do not mount the host Docker socket through a generic app recipe.
