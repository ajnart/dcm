# Research methods

## Official documentation discovery

Start from the upstream project or specification. Find installation, container, configuration, upgrade, migration, and release pages as separate evidence when the question spans them. Record the upstream project and container publisher independently. A vendor image, community image, and upstream product are distinct claims.

For each source, record `checkedAt`, source role, requested URL, canonical URL, final URL, title evidence, and limitations. A current page does not prove a mutable image tag or old Compose example is current.

## Compose extraction

Use filtered documentation reads to isolate one Compose snippet. Redact it first when it came from a dynamic page, then pass it to `extract-compose.ts`. The extractor supports a conservative Compose subset and reports unsupported YAML rather than guessing.

Retain only service and image references, ports, container volume targets and purposes, environment names with secret-reference status, health presence, networks, restart, init, and empty provenance slots. Never retain environment values, bind-mount sources, generated keys, interpolation results, or a fully rendered Compose model.

## Alternative comparison

Compare the same operator outcome and host constraints. Give each claim a source role:

- `official`: upstream behavior, support, lifecycle, and product requirements;
- `vendor`: commercial packaging or hosted-control-plane facts;
- `image-publisher`: image-specific users, paths, tags, and release behavior;
- `community`: popularity, experience, and pain points only.

Compare topology, storage, architectures, authentication, exposure, backup, upgrade, and support boundaries. Popularity is dated directional evidence, never a security or maintenance guarantee.

## Lifecycle review

Record `active`, `transitioning`, `verify`, or `retired`, a check date, primary evidence, and replacement metadata when transitioning or retired. Keep aliases for migration routing, never as a new-install recommendation. Validate the container publisher and image provenance separately from upstream activity.

Flag implicit `latest`, mutable channel tags, unresolved image variables, and broad major/minor tags. A floating tag can be acceptable for an explicitly labelled experiment, but it is not deterministic production evidence.
