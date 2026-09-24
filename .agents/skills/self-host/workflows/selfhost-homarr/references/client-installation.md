# Client installation

## Private profile

Profiles live at `<project>/.selfhost/homarr/<profile>`. Initialize with a normalized HTTPS origin, or plaintext HTTP only for a local/private hostname or address. Skill-owned directories are mode `0700`; profile files are mode `0600`.

Store a first key with `profile.ts store-key <absolute-profile-path>`. Replace an existing key only with the explicit `rotate-key` command. Both commands accept the key from stdin and reject key arguments or environment transport.

## One-time browser-key pipeline

Use `agent-browser` to open `/manage/tools/api`, select **Authentication**, and
create one key for the profile. Resolve its one-time input from a fresh
snapshot, then make `agent-browser get value @eN` the left side of one pipeline.
Make `bun <skill-dir>/scripts/profile.ts store-key
<absolute-profile-path>` the right side.

The left side retrieves the key once from the live page without a screenshot, clipboard file, shell variable, log, or persistent browser artifact. The right side consumes stdin immediately. Neither side runs alone. Never replay a browser command that would print the key after storage.

For rotation, use the same single pipeline with `rotate-key` on the right.

For an existing media-harness key file, use the exact owner handoff in [media-profile-handoff.md](media-profile-handoff.md). `import-media-key` consumes the complete one-line file on stdin and never prints its value.

## Fragment generation and merge gate

The generator writes one no-clobber fragment under the profile's private `client-fragments` directory:

| Format | Artifact | Shape |
| --- | --- | --- |
| `claude-code` | `claude-code.json` | `mcpServers` stdio entry |
| `codex` | `codex.toml` | `mcp_servers` TOML table |
| `pi` | `pi.json` | `mcpServers` stdio entry |
| `generic-json` | `generic.json` | named stdio JSON object |
| `generic-toml` | `generic.toml` | named stdio TOML object |

Each fragment points to the bridge and contains only the absolute Node executable, this skill's absolute bridge path, and the non-secret profile path. It contains no URL, credential, or credential-file path. Pi's JSON fragment can be merged into its MCP configuration. Profiles without an integration policy remain strictly read-only. A policy-enabled fragment adds `-integration-request` to its MCP server name so the merge diff exposes the capability. The policy must be selected and reviewed before fragment generation; use a separate profile and installation approval for that capability.

Fragment generation does not authorize installation. Before touching a real client config:

1. show the target client, target config path, server name, and merge-only diff;
2. require the literal approval `INSTALL-MCP:<profile>`;
3. parse the existing config and preserve every unrelated entry;
4. merge only the generated server entry, retain a recoverable copy, and parse the result;
5. run client-specific discovery without exposing environment or profile internals.

Without the exact approval, stop after generating and validating the fragment.
