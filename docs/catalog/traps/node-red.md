# Node-RED traps

## Pitfalls

- The default settings file does not enable editor or Admin API authentication; private port binding alone is not administrator setup.
- POST /auth/token returns an expiring access token; do not hand it off as a durable API key.
- A flow editor can become a broad control plane without clear ownership.

## Security

- Configure adminAuth with a bcrypt-hashed password in /data/settings.js before exposing the editor or Admin API.
- Review contributed nodes and every credential or host integration used by flows.
