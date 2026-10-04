# Writable private application configuration

Use this contract only when an upstream app must update its credential-bearing
configuration after first run. Immutable generated files remain `privateConfigs`;
ordinary persistent data remains a normal bind or named volume.

The app folder owns:

- `mutableConfigs`: one declaration per file, its directory mount, filename,
  immutable image/UID evidence, non-secret inputs and executable source files.
- `mutable-config.ts`: named `mutableConfigHook` with `initialize(context)` and
  `validate(content, context)`. The hook obtains declared private inputs through
  `readPrivateFile(id)`, never through command arguments or public recipe data.
- The usual recipe and setup adapter. Input-dependent recipes use the existing
  `derived-recipe-adapter.json` contract, not a new command router.

The shared owner creates the directory with mode `0700` and the file with mode
`0600`, without replacement. Saved files are parsed and checked semantically;
valid app-written fields are retained byte-for-byte. Missing or invalid files on
prepared resume, startup or inspection stop the operation instead of generating
a replacement identity.

Source and executable hashes enter the saved derived binding and approval.
The CLI, app bundle and canonical Compose startup helper use the same contract.
Every startup validates the retained owner and config. Setup adapters can call
`context.secrets.verifyMutableConfigs()` before releasing saved credentials;
this method accepts no paths or caller-supplied success flag.

## Current example and limits

ArchiveTeam Warrior uses this route for an authenticated **idle** control
interface: saved Basic credentials, no selected archival project, and a bounded
read-only opening snapshot. It preserves the runner's generated identity. It
does not create an administrator account or API key, prove archival operation,
disable HQ registration/updates, or enforce an outbound destination allowlist.

The container UID must match the private file's actual host owner. Before
startup/readback, an exact-context daemon inspection rejects rootless or
user-namespace remapping, including a rootless daemon behind the `default`
context. Namespace-aware custody is not implemented; the engine does not widen
permissions, change ownership, or claim a successful install on those hosts.

## File-backed first accounts

Authelia consumes `initial-admin-from-mutable-config`: the recipe binds the
generated private password to exact username, display name, email and mutable
user-database inputs. Its adapter verifies the retained database before login
and verifies the resulting secure session before reporting account readiness.
The shared engine does not infer application privileges from the account label.

The installed Node CLI uses a bounded Bun 1.4+ worker for Argon2id and private
YAML parsing. Requests travel through private pipes, never argv or inherited
application environment. The executed worker lives in the source-hashed mutable
runtime bundle; changing it invalidates the saved source binding. A missing Bun
runtime or malformed response stops setup without releasing child output.

Authelia additionally requires the exact saved private HTTPS portal route and a
valid cookie domain. Cookie domains use the pinned Public Suffix List parser,
including private suffixes and IANA special-use names, rather than a hand-written
suffix list. Private HTTPS alone does not establish working SSO, client trust,
DNS or a usable cookie domain. Passing source/package fixtures is not live
acceptance.
