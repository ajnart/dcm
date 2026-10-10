# NZBGet traps

## Pitfalls

- The archived legacy repository and images can be mistaken for the maintained successor.
- The official Docker image documents NZBGET_PASS as a plain environment variable, not a file-backed secret; shared Compose must generate its private environment file before the container starts.
- NZBGet RPC uses username/password pairs and does not document an API key.

## Security

- Keep provider credentials and the control interface on a private network; the RPC control interface uses HTTP Basic authentication unless HTTPS is configured.
- Change the documented default control password before exposing the interface to another device.
