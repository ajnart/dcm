# Beszel 0.20.0 shared first-run setup

The pinned source establishes a headless first-user contract. `GET /api/beszel/first-run` returns a boolean, and `POST /api/beszel/create-user` accepts `email` and `password` only while there are no Hub users. The handler checks for the temporary superuser and, in one database transaction, creates a Hub user with role `admin`, creates a PocketBase `_superusers` record with the same credential, then deletes the temporary superuser. It returns HTTP 200 after completion. The shared adapter saves a pre-send checkpoint, refuses to adopt an existing account without it, and verifies both logins after any attempted signup. This is source-level behavior, not a live-container acceptance result.

- [Beszel v0.20.0 route registration](https://github.com/henrygd/beszel/blob/v0.20.0/internal/hub/api.go#L150-L165)
- [Beszel v0.20.0 transactional first-user handler](https://github.com/henrygd/beszel/blob/v0.20.0/internal/users/users.go#L68-L130)
- [Beszel account separation](https://beszel.dev/guide/user-accounts)
- [PocketBase password authentication](https://pocketbase.io/docs/authentication/)

The shared recipe retains the fixed private `admin@example.test` login and a generated password. The adapter does not claim monitoring: the Hub-only recipe deploys no agent. It also does not save a general REST API key. Beszel's `/api/beszel/getkey` returns the Hub's public SSH key, not an API key; `/api/beszel/universal-token` concerns agent enrollment and its default token expires after one hour. PocketBase does not offer traditional API keys; its superuser impersonation tokens carry broad privileges and are outside this setup's scope. REST clients can authenticate as the saved Hub user when needed.

- [Beszel v0.20.0 info and universal-token handlers](https://github.com/henrygd/beszel/blob/v0.20.0/internal/hub/api.go#L166-L185)
- [Beszel v0.20.0 universal-token implementation](https://github.com/henrygd/beszel/blob/v0.20.0/internal/hub/api.go#L243-L330)
- [Beszel REST API guide](https://beszel.dev/guide/rest-api)
- [PocketBase API-key caveat](https://pocketbase.io/docs/authentication/#api-keys)

No Docker, browser, or live first-account test was run. Agent registration, fresh metrics, restart persistence, and a real operator-selected email remain separate acceptance work.
