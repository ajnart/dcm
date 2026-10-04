# Stalwart management bootstrap audit — 2026-10-03

Pinned catalog image: `stalwartlabs/stalwart:v0.16.24`. No deployment performed.
Context7 resolved `/stalwartlabs/website`; current Docker/recovery/API-key
documentation was checked, then the v0.16.24 credential handler and codec were
read directly. Version-pinned source takes precedence over rolling examples.

## Implemented app-local boundary

`headless.ts` already proves fresh bootstrap, durably captures the returned
permanent `admin@<domain>` password, verifies administrator/domain/hostname
readback through the selected canonical HTTPS route, removes both recovery
variables via the exact owner's lifecycle facility, and requires rejection of
the recovery login. `createStalwartApiKey` now composes that proof with one
checkpointed management-key creation and authenticated key metadata readback.

The key uses inherited administrator permissions and no IP restriction;
review must disclose this privileged management scope. Username, password
and key are separate values. The generated management key is not an
owner-issued enterprise license and cannot authenticate mail protocols.

The source-backed flow is `x:ApiKey/get` -> exact create approval -> durable
attempt -> `x:ApiKey/set` -> immediate fsync of private `{id,secret}` -> capture
checkpoint -> Bearer `x:ApiKey/get` of the exact ID/scope. Lost create responses
cannot be replayed; capture-checkpoint failure resumes from already saved bytes.

## Remaining engine boundary

No installable recipe or discoverable setup adapter was added. The existing
derived-recipe and saved canonical-origin seams cannot safely replace:

- Exact fresh `config.json` absence and storage ownership inspection.
- Approved recovery env start/wait/removal/restart, including live and saved
  absence of both `STALWART_RECOVERY_MODE` and `STALWART_RECOVERY_ADMIN`.
- Exact-owner private directory and durable CAS journals under one setup lease.
- Private recovery plus approved canonical HTTPS request transport with exact
  request-effect approval and capture-before-followup password/key storage.

Identity/storage derivation alone cannot mark installation ready while recovery
access remains active. Catalog support stays discovery-only. Native mail TLS,
DNS authentication, SMTP/client ports, anti-abuse, external delivery, restart
persistence and backup/restore acceptance remain separate unverified gates.

## Sources

- [Docker](https://stalw.art/docs/install/platform/docker/)
- [Bootstrap](https://stalw.art/docs/configuration/bootstrap-mode/)
- [Recovery](https://stalw.art/docs/configuration/recovery-mode/)
- [API-key object](https://stalw.art/docs/ref/object/api-key/)
- [Management-only API keys](https://stalw.art/docs/auth/authentication/api-key/)
- [Pinned Bootstrap handler](https://github.com/stalwartlabs/stalwart/blob/v0.16.24/crates/jmap/src/registry/mapping/bootstrap.rs)
- [Pinned ApiKey create/get handler](https://github.com/stalwartlabs/stalwart/blob/v0.16.24/crates/jmap/src/registry/mapping/account.rs)
- [Pinned key encoding](https://github.com/stalwartlabs/stalwart/blob/v0.16.24/crates/common/src/auth/credential.rs)

## Exact future recipe/closure descriptor

The app-owned selection needs `canonical-origin` (exact HTTPS origin),
`hostname` (that origin's FQDN), `mail-domain` (explicit FQDN), and the owner-bound
storage/log paths. The pinned service is `stalwart-mail`, image
`stalwartlabs/stalwart:v0.16.24`, image-default user, named configuration/data
volumes at `/etc/stalwart` and `/var/lib/stalwart`, and only management TCP 8080
published on the exact approved private bind. No SMTP/client ports, public
ingress, automatic ACME or DKIM work is selected by this descriptor. Do not
generate `config.json`: the fresh-absence check is a bootstrap precondition.

The temporary runtime descriptor has `STALWART_RECOVERY_MODE=1` and
`STALWART_RECOVERY_ADMIN=recovery:<generated-32-byte-hex-password>` in the exact
owner-only env file. The retained recovery password is rejection evidence,
never the permanent credential handoff. The post-bootstrap runtime descriptor
omits both keys entirely; updating the saved env without recreating the running
service does not satisfy closure.

Closure preconditions are: captured mode-0600 permanent-admin password; exact
hostname/domain/internal-directory/RocksDB readback; verified canonical HTTPS
administrator access; and exact separately approved environment removal plus
recreation/restart of only this owned service. Closure evidence is saved **and**
live absence of both recovery keys, valid permanent credentials after restart,
and HTTP 401 for the captured old recovery credential. Ambiguous closure is
observed before another mutation, not automatically replayed. Only then create
the separately approved management key with the once-returned capture/readback
contract above. Mail-server acceptance must remain a separate incomplete claim.

Validation scope: only the changed helper's Bun build and
`packages/cli/tests/stalwart-headless.test.ts`; synthetic fixture, not Docker or
mail acceptance. Both passed using Bun 1.4.0. No secrets, runtime files or live
setup state were read.
