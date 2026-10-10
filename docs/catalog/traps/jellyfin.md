# Jellyfin traps

## Pitfalls

- Hardware acceleration depends on matching host drivers and devices.

## Security

- Keep administration private and approve any GPU device access.

## From docs/jellyfin.md

### Traps

- If public readiness reports `NO_RESPONSE` while Compose says `Up`, check the
  run's Jellyfin supervisor and a redacted error classification before browser
  fallback. In a parallel-run test, `service-jellyfin` repeatedly stopped with
  `System.IO.IOException` because the host's per-user inotify instance limit
  was exhausted. Check `fs.inotify.max_user_instances`; first stop only
  completed, task-owned Compose runs to free capacity, then retry once the
  supervisor is up and the public endpoint responds. A host-wide sysctl change
  needs separate approval. Container `Up` alone is not Jellyfin readiness.
- `localhost` inside Seerr points to Seerr, not Jellyfin.
- Do not skip libraries: Seerr service configuration and availability scans need
  usable library/root-folder choices.
- Finish the wizard and verify a post-login page; HTTP 200 alone is insufficient.

Sources: [Jellyfin container docs](https://jellyfin.org/docs/general/installation/container/),
[hotio image docs](https://hotio.dev/containers/jellyfin/),
[Linux inotify limits](https://www.kernel.org/pub/linux/docs/man-pages/book/man-pages-6.13.pdf).

Startup ordering source: [Jellyfin 10.11.11 StartupController](https://github.com/jellyfin/jellyfin/blob/v10.11.11/Jellyfin.Api/Controllers/StartupController.cs).
