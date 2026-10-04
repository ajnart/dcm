# Homarr trusted-certificate API boundary

Checked 2026-10-04 against official Homarr `dev` commit
`917d92c9f31829e8ce9d8411daf69d28c89a8d8b`. The GitHub commit API independently
confirmed that current ref; the certificate-router and certificate-files blob
IDs matched the pinned local Git objects (`cab6633f...`, `fcc058ad...`). This is
source evidence, not deployed-image compatibility or live acceptance. No private
state, deployments, tests, CI, or commits were used.

## Outcome

Homarr can accept an administrator's certificate upload through API-key-authenticated
tRPC. It cannot currently provide the inspect/create-only/readback contract
needed for safe automatic trust provisioning. A content-derived filename is a
useful proposed owner identity, not proof that an existing file is absent or
matches. Keep Frigate native integration blocked until the trust boundary is
implemented and verified; do not silently overwrite trust or weaken TLS.

## Proven source contract

- The tRPC handler tries the `ApiKey` header first, then session authentication.
  An API key is `id.token`, validates against its owning user, and creates a
  session using that user's current group permissions. Certificate operations
  require `admin`, not merely integration permission. A valid administrator-owned
  key is sufficient at this source revision; a non-admin key is not.
  [Handler](https://github.com/homarr-labs/homarr/blob/917d92c9f31829e8ce9d8411daf69d28c89a8d8b/apps/nextjs/src/app/api/trpc/%5Btrpc%5D/route.ts#L43-L64),
  [key validation](https://github.com/homarr-labs/homarr/blob/917d92c9f31829e8ce9d8411daf69d28c89a8d8b/packages/auth/api-key/get-api-key-session.ts),
  [permissions](https://github.com/homarr-labs/homarr/blob/917d92c9f31829e8ce9d8411daf69d28c89a8d8b/packages/auth/callbacks.ts#L11-L38),
  [procedure](https://github.com/homarr-labs/homarr/blob/917d92c9f31829e8ce9d8411daf69d28c89a8d8b/packages/api/src/router/certificates/certificate-router.ts#L19-L51).
- `certificates.addCertificate` accepts a multipart `FormData` field named
  `file`. Homarr's UI passes an actual `File`, selects non-batched `httpLink`
  for non-JSON inputs, uses an identity input serializer, and deserializes the
  response through SuperJSON. The base is `/api/trpc`. This is not a JSON
  `{file: pem}` mutation, a REST route, or an MCP tool. Preserve the actual
  multipart protocol; do not infer a wire payload solely from the route name.
  [Upload caller](https://github.com/homarr-labs/homarr/blob/917d92c9f31829e8ce9d8411daf69d28c89a8d8b/apps/nextjs/src/app/%5Blocale%5D/manage/tools/certificates/_components/certificate-upload-form.tsx#L44-L69),
  [transport selection](https://github.com/homarr-labs/homarr/blob/917d92c9f31829e8ce9d8411daf69d28c89a8d8b/apps/nextjs/src/app/%5Blocale%5D/_client-providers/trpc.tsx#L199-L219),
  [base path](https://github.com/homarr-labs/homarr/blob/917d92c9f31829e8ce9d8411daf69d28c89a8d8b/packages/api/src/shared.ts#L44-L57).
- Upload validation restricts filenames to word characters, hyphen, dot, and
  space; requires `.crt` or `.pem`; caps size at 1 MiB; and parses content using
  `X509Certificate`. It does not check CA status, validity dates, ownership,
  expected fingerprint, existing contents, or create-only semantics. The mutation
  returns no filename/fingerprint readback.
  [Validation](https://github.com/homarr-labs/homarr/blob/917d92c9f31829e8ce9d8411daf69d28c89a8d8b/packages/validation/src/certificates.ts),
  [mutation](https://github.com/homarr-labs/homarr/blob/917d92c9f31829e8ce9d8411daf69d28c89a8d8b/packages/api/src/router/certificates/certificate-router.ts#L27-L51).
- The production store defaults to `/appdata/trusted-certificates`, overridable
  by `LOCAL_CERTIFICATE_PATH`. Upload uses ordinary `fs.writeFile`: the same
  filename is overwritten, without exclusive-create, atomic rename, or symlink
  rejection. Upload itself does not create the parent directory; the list loader
  does. Do not assume a freshly initialized API-only instance has that directory.
  [Filesystem implementation](https://github.com/homarr-labs/homarr/blob/917d92c9f31829e8ce9d8411daf69d28c89a8d8b/packages/core/src/infrastructure/certificates/files/index.ts).
- The certificate router contains add/remove and hostname-mismatch trust/remove
  only: no list/get/fingerprint query. Certificates are absent from the OpenAPI
  router and have no enabled MCP metadata. The administrator UI lists certificates
  by reading the filesystem directly in its server page; that is not an
  API-key-addressable readback contract.
  [Complete certificate router](https://github.com/homarr-labs/homarr/blob/917d92c9f31829e8ce9d8411daf69d28c89a8d8b/packages/api/src/router/certificates/certificate-router.ts),
  [OpenAPI router](https://github.com/homarr-labs/homarr/blob/917d92c9f31829e8ce9d8411daf69d28c89a8d8b/packages/api/src/open-api.ts#L19-L31),
  [MCP metadata filter](https://github.com/homarr-labs/homarr/blob/917d92c9f31829e8ce9d8411daf69d28c89a8d8b/packages/api/src/mcp-tools.ts#L72-L80),
  [UI listing](https://github.com/homarr-labs/homarr/blob/917d92c9f31829e8ce9d8411daf69d28c89a8d8b/apps/nextjs/src/app/%5Blocale%5D/manage/tools/certificates/page.tsx#L25-L38).
- Newly created shared HTTP agents load the current certificate files each time.
  TLS contexts are cached by CA-content hash, so changed contents select a
  different context. The ordinary fetch helper constructs such an agent unless
  given a dispatcher override. No restart is implied for that path; already
  constructed agents or override clients are not proven to reload. This does not
  establish hostname/DNS reachability or application acceptance.
  [Loader](https://github.com/homarr-labs/homarr/blob/917d92c9f31829e8ce9d8411daf69d28c89a8d8b/packages/core/src/infrastructure/certificates/files/index.ts#L12-L37),
  [agent and request lifecycle](https://github.com/homarr-labs/homarr/blob/917d92c9f31829e8ce9d8411daf69d28c89a8d8b/packages/core/src/infrastructure/http/request.ts#L23-L44).

## Auto-Stack transport and smallest safe seam

At baseline `f04fd11`, `packages/cli/src/shared-homarr.ts:337` constructs
`HomarrAttachClient`; there is no `sharedHomarrClient` symbol. Its request method
in `packages/cli/src/homarr-attach.ts:187` serializes every mutation as
`JSON.stringify({json: input})` with JSON content type. It cannot upload a `File`.
The setup transport (`packages/cli/src/control-panel/setup-transport.ts:700`)
accepts bounded string/`Uint8Array` bodies, not `FormData`; its private curl branch
uses the same bytes. Multipart support would need a reviewed bounded encoder or
dedicated upload interface shared across fetch/curl, retaining key secrecy,
redirect rejection, timeouts, and approved-request identity.

Recommended upstream gap: admin-only bounded inspect by managed filename plus
atomic create-only upload returning the stored DER SHA-256 fingerprint. Reject
symlinks/non-regular files; identical existing fingerprints may be idempotent,
but different contents must fail without mutation. Inspection alone followed by
ordinary upload remains a race. A managed name such as
`selfhost-ca-<DER-sha256>.crt` avoids normal rotations sharing a filename, but
does not replace those server-side guarantees.

Any later provisioning plan must derive the certificate from the reviewed saved
HTTPS owner, validate CA/validity and approved fingerprint locally, record only
non-secret identity/evidence, approve the additive global Homarr trust change,
then read it back and verify the selected stored integration through Homarr.
Do not invoke hostname-mismatch trust, alter unrelated certificates, fall back to
Frigate's unauthenticated port, or claim live success from source research.

## Prepared implementation

[Homarr PR #7033](https://github.com/homarr-labs/homarr/pull/7033), based on `dev`,
implements admin-only JSON tRPC and REST inspect/ensure at commit
`1a93f84819da6c9517d99ffebc480082195f73c2`. Inspection returns public metadata;
ensure atomically creates one valid self-signed root CA or accepts identical
existing bytes, without replacing different contents. `sha256` hashes raw PEM
bytes; `fingerprint256` hashes DER. This patch is not yet evidence that the
running `homarr:dev` image supports these endpoints. The CLI trust review blocks
on an unavailable API and retains Frigate's separate integration transport gap.
