# Household manifest builder

`scripts/household-plan.ts` maps any nonempty subset of Navidrome,
Audiobookshelf, and Vaultwarden into the strict `selfhost-compose` manifest.
Only explicitly listed apps are included. It does not create storage,
pull images, render Compose, apply changes, create accounts, or deploy Homarr.
Immich and Nextcloud remain separate guided stages.

Copy [household-plan.example.json](household-plan.example.json) to a private
working file and replace every example value with current host observations and
approved choices. Supply immutable image references ending in
`@sha256:<64 lowercase hex characters>`, numeric non-root UID/GID values,
private host binds, owned storage paths, and path ownership evidence. The
Audiobookshelf `/config` source must be on a local filesystem. The builder does
not create or change any supplied path.

The optional `integrationNetwork` must name a network whose owner is already
verified in `observed.networks`. It attaches the three services to that network
so the existing media Homarr can reach them; it does not add another Homarr.
Omit it when no existing control-plane network has been verified.

Generate a validated manifest without applying it:

```text
bun scripts/household-plan.ts --input /absolute/path/household-input.json > /absolute/path/household-manifest.json
```

The command emits the manifest only after `selfhost-compose validate` passes.
Use the compose owner for subsequent read-only planning and rendering:

```text
bun ../selfhost-compose/scripts/compose-project.ts plan --input /absolute/path/household-manifest.json
bun ../selfhost-compose/scripts/compose-project.ts render --input /absolute/path/household-manifest.json --output-dir /approved/project/directory
```

Vaultwarden sets `SIGNUPS_ALLOWED=false` and `INVITATIONS_ALLOWED=false` by
default. `bootstrapRegistration: true` is accepted only with a private bind and
is solely the controlled first-account interval described in
[the Vaultwarden recipe](household/vaultwarden.md). A later owner-validated
manifest must close registration again. `DOMAIN` must be the approved HTTPS
origin. No secret value or account data belongs in this input.
