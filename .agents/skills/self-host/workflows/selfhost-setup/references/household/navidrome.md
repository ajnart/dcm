# Navidrome household onboarding

Use this recipe after `selfhost` selects Navidrome and `selfhost-compose` owns
the approved project mutation. This is guided: no adapter currently creates the
account or transfers its password to Homarr automatically.

## Inputs and Compose contract

Record before apply:

- an immutable digest resolved from the official `deluan/navidrome` image;
  upstream's `latest` example is discovery evidence, not a production pin;
- a host UID:GID that owns the data directory and can read the music library;
- writable persistent storage at `/data` and owned music mounted read-only at
  `/music`;
- container port `4533`, reachable only through the selected private plan; and
- opaque references for the selected administrator username and password.

Set `user: UID:GID`. The official image ignores `PUID` and `PGID`. Apply only
through the selected Compose project after approval.

## Onboarding

1. Confirm the runtime UID:GID, writable `/data`, readable `/music`, and private
   browser reachability on port `4533`.
2. Open the private base URL. On a fresh database, require **Create Admin**.
   Fill username, password, and confirmation through the credential-safe
   browser helper, then select **Create Admin**.
3. Require an authenticated page for that account and wait for the initial scan.
   If owned music exists, require an expected album or track. Otherwise record
   library content as pending rather than adding sample media.
4. In Homarr, create one Navidrome integration at
   `http://navidrome:4533`. Use the same username and password; Subsonic API
   access is enabled by default. Test before saving, link the app tile, and add
   Audio Stats only after the test passes.

## Acceptance

- The image digest and runtime UID:GID match the approved plan.
- `/data` survives container replacement and `/music` is readable without write
  access.
- The selected administrator signs in after a fresh reload.
- The scan finishes without a permission failure.
- Owned music is visible, or its deliberate absence remains pending.
- Homarr's username/password integration test passes over the internal URL.
- The tile opens the private URL and Audio Stats has no integration error.

## Resume

- **Create Admin** visible: resume account creation with the same secret refs.
- Login visible: sign in; do not create a second first administrator.
- Authenticated but empty: inspect scan state and mounts before settings.
- Navidrome passes but Homarr fails: retry only credential transfer, the
  integration test, and widget evidence.

Sources checked 2026-09-21: [Docker](https://www.navidrome.org/docs/installation/docker/),
[getting started](https://www.navidrome.org/docs/getting-started/),
[first-admin constraint](https://www.navidrome.org/docs/usage/admin/cli/user/),
[Subsonic API](https://www.navidrome.org/docs/developers/subsonic-api/), and
[Homarr integration](https://homarr.dev/docs/integrations/navidrome/).
