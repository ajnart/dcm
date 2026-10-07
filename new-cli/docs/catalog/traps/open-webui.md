# Open WebUI traps

## Pitfalls

- A chat UI can expose a privately bound model API if ingress is misconfigured.
- Headless admin creation applies only to an empty user database; later restarts do not reset an existing password.
- API keys require an enabled global setting, are user-scoped, and creating another key replaces the old one.

## Security

- Keep the first-start admin password and persistent WEBUI_SECRET_KEY private; protect accounts, conversation history, provider keys, and tool integrations.
