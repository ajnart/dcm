# Nginx Proxy Manager traps

## Pitfalls

- GUI state can diverge from generated project configuration.
- The login API issues bearer tokens, not a documented durable API key.
- Do not supply INITIAL_ADMIN_PASSWORD to this pinned image: backend/setup.js logs it at INFO during fresh-database bootstrap. The first-user HTTP adapter checks setup mode, checkpoints before creation, and verifies the saved email/password without replaying an uncertain creation.

## Security

- Keep the admin interface private and protect certificate data.
- Public 80/443, DNS and TLS ownership require a separate ingress approval.
