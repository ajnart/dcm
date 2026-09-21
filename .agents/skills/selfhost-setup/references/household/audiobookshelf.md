# Audiobookshelf household onboarding

Use this recipe after `selfhost` selects Audiobookshelf and `selfhost-compose`
owns the approved project mutation. This is guided: no adapter currently
creates the root account, library, or Homarr token automatically.

## Inputs and Compose contract

Record before apply:

- an immutable digest resolved from the official
  `ghcr.io/advplyr/audiobookshelf` image; upstream's `latest` example is
  discovery evidence, not a production pin;
- separate writable persistent paths at `/config` and `/metadata`;
- owned audiobooks at `/audiobooks`, plus `/podcasts` only when selected;
- container port `80`, reachable only through the selected private plan; and
- opaque references for the selected root username and password.

Keep `/config` on storage local to the Docker host because it contains SQLite.
Do not nest mount points. Use Compose `user` when a different UID:GID is needed;
the image ignores `PUID` and `PGID`.

## Onboarding

1. Confirm private browser reachability on container port `80`, writable
   `/config` and `/metadata`, and readable `/audiobooks`.
2. Open the private base URL. On a fresh database, create the root account with
   the selected username and password through the credential-safe helper.
   Audiobookshelf has no default administrator credentials.
3. In server settings, add a Books library rooted at `/audiobooks` and scan it.
   Use one folder per book, such as
   `/audiobooks/Author/Book/<audio files>`. Add `/podcasts` only when selected.
4. Open **Settings → Users → API Keys** (`/config/api-keys`) and create an API
   key named for Homarr that acts as the selected root account. Leave expiration
   unset only when the approved operating policy permits a non-expiring key.
   Audiobookshelf shows the key once in a persistent creation dialog. Before
   closing it, run the private capture helper without `--selector`; it accepts
   only the visible dialog's fixed readonly **API Key** field. Keep the key out
   of arguments and evidence.
5. In Homarr, create one Audiobookshelf integration at
   `http://audiobookshelf:80` with secret type **API Key**. Test before saving,
   link the app tile, and add Audio Stats only after the test passes.

## Acceptance

- The image digest matches the approved plan.
- `/config` and `/metadata` survive container replacement.
- The root account signs in after a fresh reload.
- The Books library uses `/audiobooks` and scans without mount/database errors.
- An expected owned book is visible, or deliberate media absence stays pending.
- Homarr's API-key integration test passes over the internal URL.
- The tile opens the private URL and Audio Stats has no integration error.

## Resume

- First-run creation visible: resume with the same secret refs.
- Login visible: sign in; do not replace the root account.
- Account exists but library does not: create only the missing Books library.
- Library exists but is empty: verify the mount and folder layout, then rescan.
- Audiobookshelf passes but Homarr fails: repeat only private token capture, the
  integration test, and widget evidence.

Sources checked 2026-09-21: [Docker](https://audiobookshelf.org/docs/documentation/install/docker/),
[server FAQ](https://audiobookshelf.org/docs/faq/server/),
[book layout](https://audiobookshelf.org/docs/documentation/libraries/book-library/directory-structure/),
[users](https://audiobookshelf.org/docs/documentation/server-management/user-management/),
[API keys](https://audiobookshelf.org/docs/documentation/server-management/api-keys/),
[v2.36.1 API-key page](https://github.com/advplyr/audiobookshelf/blob/v2.36.1/client/pages/config/api-keys/index.vue),
[v2.36.1 creation dialog](https://github.com/advplyr/audiobookshelf/blob/v2.36.1/client/components/modals/ApiKeyCreatedModal.vue),
[v2.36.1 text input](https://github.com/advplyr/audiobookshelf/blob/v2.36.1/client/components/ui/TextInput.vue),
and [Homarr integration](https://homarr.dev/docs/integrations/audiobookshelf/).

The route and fixed creation-dialog DOM contract are source-validated against
tag `v2.36.1` at commit `4b67c170ce46fd6ba770dc55c189ca13fef89b02`.
They remain runtime-untested because no live Audiobookshelf instance was
available during this update.
