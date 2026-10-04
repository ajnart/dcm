# Shared goal composition — 2026-10-03

The existing canonical planner already resolves goals, alternatives, Homarr
opt-out, and implied dependencies. Reuse it; do not implement another goal
resolver in the panel. The new shared projection keeps every catalog selection
visible, distinguishes bundled private services, and reviews only missing app
units on an existing shared owner.

Rechecked pinned publisher topology:

- [Immich v3.2.2 Compose](https://raw.githubusercontent.com/immich-app/immich/v3.2.2/docker/docker-compose.yml): its frontend depends on `database` and `redis`; the latter is Valkey. Both are already in the app recipe. The release download URL was unavailable through the web reader; the matching tagged source was readable.
- [Paperless-ngx v3.2.1 Compose](https://github.com/paperless-ngx/paperless-ngx/blob/v3.2.1/docker/compose/docker-compose.postgres.yml): the database and Valkey broker are private dependencies bundled with the frontend.
- [Docmost v0.96.0 Compose](https://raw.githubusercontent.com/docmost/docmost/v0.96.0/docker-compose.yml): PostgreSQL and Redis are private dependencies. Only PostgreSQL is a named app dependency in this catalog; cache remains a capability, not a fabricated Valkey mapping.

`composition.json` is recipe-hash-bound selection metadata. It does not modify
these recipes or existing project state. Explicit database roles remain
standalone selections. Existing-unit reuse requires the same saved recipe
hash; ambiguous goals, source changes, or separately owned ingress/VPN stay
blocked. Focused fixtures exercise canonical producer plans, metadata drift,
retained selection and exact dependency coverage. No Docker or live-score
credit follows from this change.
