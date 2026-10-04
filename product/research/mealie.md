# Mealie standalone candidate (2026-09-29)

Status: discovery-only. The [official SQLite Compose example](https://mealie.io/documentation/getting-started/installation/sqlite/)
is a small single-service deployment, but a fresh instance has
[published default credentials](https://mealie.io/documentation/getting-started/installation/installation-checklist/).
The current recipe engine cannot provision its administrator from a private
password file. Shipping only the Compose step would expose a known account.

Promotion needs a version-pinned private recipe, an interruption-safe direct
API or script route that rotates the default credential before calling setup
complete, a verified fresh login, and scoped restart persistence. Until that
exists, do not offer Mealie in the installable picker. An optional Homarr tile
is not proof of account setup or a native integration.
