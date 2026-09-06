# Client installation

## Private profile

Profiles live at `<project>/.selfhost/homarr/<profile>`. Initialize with a normalized HTTPS origin, or plaintext HTTP only for a local/private hostname or address. Skill-owned directories are mode `0700`; profile files are mode `0600`.

Store a first key with `profile.ts store-key <absolute-profile-path>`. Replace an existing key only with the explicit `rotate-key` command. Both commands accept the key from stdin and reject key arguments or environment transport.

## One-time browser-key pipeline

When the user asks to create a key, use `agent-browser` to open `/manage/tools/api`, create Authentication, and make the browser accessor the left side of one pipeline. Make `bun <skill-dir>/scripts/profile.ts store-key <absolute-profile-path>` the right side.

The left side retrieves the key once from the live page without a screenshot, clipboard file, shell variable, log, or persistent browser artifact. The right side consumes stdin immediately. Neither side runs alone. Never replay a browser command that would print the key after storage.

For rotation, use the same single pipeline with `rotate-key` on the right.

## Fragment generation and merge gate

The generator writes one no-clobber fragment under the profile's private `client-fragments` directory:

| Format | Artifact | Shape |
| --- | --- | --- |
| `claude-code` | `claude-code.json` | `mcpServers` stdio entry |
| `codex` | `codex.toml` | `mcp_servers` TOML table |
| `generic-json` | `generic.json` | named stdio JSON object |
| `generic-toml` | `generic.toml` | named stdio TOML object |

Each fragment points to the strictly read-only bridge and contains only the absolute Node executable, this skill's absolute bridge path, and the non-secret profile path. It contains no URL, credential, credential-file path, credential environment-variable name, or mutation enablement.

Fragment generation does not authorize installation. Before touching a real client config:

1. show the target client, target config path, server name, and merge-only diff;
2. require the literal approval `INSTALL-MCP:<profile>`;
3. parse the existing config and preserve every unrelated entry;
4. merge only the generated server entry, retain a recoverable copy, and parse the result;
5. run client-specific discovery without exposing environment or profile internals.

Without the exact approval, stop after generating and validating the fragment.
