# Grafana traps

## Pitfalls

- Dashboards without a durable data source do not provide monitoring history.
- The image runs as UID 472, which cannot read host-owner mode-0600 secret mounts. The reviewed private env-file bootstrap keeps the image user unchanged; Docker operators can inspect its environment.

## Security

- Protect administration and data-source credentials.
