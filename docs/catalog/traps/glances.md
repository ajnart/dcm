# Glances traps

## Pitfalls

- The safe shared recipe monitors its own container only; host observation needs a separately approved privilege expansion.
- The documented password-file bootstrap is interactive and cannot be represented by the current shared secret inputs.

## Security

- Keep the Web UI and API private; unauthenticated API responses may expose process command lines.
- Treat host PID visibility and the Docker socket as separate explicit privilege decisions.
