# WUD staged setup readiness

Checked on 2026-10-03 against the shipped WUD 9.1.0 contract.

## Checked behavior

- The pinned [Docker watcher](https://raw.githubusercontent.com/getwud/wud/9.1.0/app/watchers/providers/docker/Docker.ts) uses the configured host, port and CA/client certificate/key files. Without a host, it falls back to its local Docker socket. `watchbydefault=false` filters labelled containers after Docker discovery; it is not an endpoint ACL.
- The pinned [store](https://raw.githubusercontent.com/getwud/wud/9.1.0/app/store/index.ts) defaults to `/store/wud.sqlite`. The staged recipe's `/store` volume is correct for that pin.
- The pinned [Basic provider](https://raw.githubusercontent.com/getwud/wud/9.1.0/app/authentications/providers/basic/Basic.ts) verifies local database credentials and returns the user's identity. The protected [`/auth/user` route](https://raw.githubusercontent.com/getwud/wud/9.1.0/app/api/auth.ts) exposes that identity without its password hash.
- The current [remote-watcher guide](https://getwud.app/docs/configuration/watchers/remote-tls/) distinguishes mTLS authentication from filtering mutating Docker API operations. Its example volume paths differ from the pinned store source, so recipe persistence must follow the pinned source.

## Corrected defect

The staged setup adapter previously accepted a record with
`dockerAuthorizationVerified=false` as ready. It now retains administrator and
inventory observations but returns `docker-authority-verification-required`,
`authorityVerified=false`, and `usableForApplicationSetup=false`. No caller-supplied
verified flags can complete this staged adapter.

WUD remains absent from the shared derived-recipe registry. Its app-local
approval claim records consent only. The common Docker inventory gate still
rejects start with `policy-unverified`: a production endpoint-policy verifier
bound to the exact owner, revision, TLS identities and policy is missing. That
verifier must be replayed at every start/add/recreate before registration is safe.
Neither an mTLS `/info` readback nor app inventory proves deny-write authorization.

Validation is limited to the two affected synthetic WUD fixtures and a source
build. No Docker, live endpoint, browser, CI, or private runtime state was used.
