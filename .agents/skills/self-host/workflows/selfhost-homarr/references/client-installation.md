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

For a standalone CLI-installed Homarr, `self-host app onboard --id homarr`
stores its verified key in the owner-only file reported by `self-host app
handoff --id homarr --project-root /absolute/project --json`. After initializing
the profile, transfer that exact file directly to `profile.ts store-key` over
stdin.

For a shared Compose project, locate the existing key with `self-host app shared
handoff --app homarr --project-root /absolute/project --project-id EXACT_ID
--json` instead. Verify the returned owner, Homarr URL and `apiKeyFile` reference;
keep the same shared owner. Transfer that exact file through the same stdin
boundary. Neither handoff needs `--show`, a browser, or another API key.

For either owner, this pipeline transfers the reviewed file without printing it:

```bash
bun -e 'process.stdout.write(await Bun.file(process.argv[1]).text())' /absolute/reviewed/homarr-api-key \
  | bun "$SKILL_DIR/scripts/profile.ts" store-key /absolute/profile-path
```

The standalone CLI can perform that owner-only transfer without the skill
runtime: `self-host homarr mcp prepare --project-root /absolute/project
--profile read-only --base-url http://127.0.0.1:7575 --api-key-file
/absolute/reviewed/homarr-api-key --require-read-only`. Its interactive Homarr flow offers the same
optional read-only preparation and verification. Neither path installs a client
fragment or proves dashboard acceptance.

Keep the key out of shell variables, arguments, terminal output, and client
fragments. Do not create another Homarr API key just to populate this profile.

## Fragment generation and merge gate

The generator writes one no-clobber fragment under the profile's private `client-fragments` directory:

| Format | Artifact | Shape |
| --- | --- | --- |
| `claude-code` | `claude-code.json` | `mcpServers` stdio entry |
| `codex` | `codex.toml` | `mcp_servers` TOML table |
| `pi` | `pi.json` | `mcpServers` stdio entry |
| `generic-json` | `generic.json` | named stdio JSON object |
| `generic-toml` | `generic.toml` | named stdio TOML object |

Each fragment points to the bridge and contains only the absolute Node executable, this skill's absolute bridge path, and the non-secret profile path. It contains no URL, credential, or credential-file path. Pi's JSON fragment can be merged into its MCP configuration. Profiles without an integration policy remain strictly read-only. A policy-enabled fragment adds `-integration-request` or `-media-request` to its MCP server name so the merge diff exposes the exact capability. The policy must be selected and reviewed before fragment generation; use a separate profile and installation approval for that capability.

Fragment generation does not authorize installation. Before touching a real client config:

1. show the target client, target config path, server name, and merge-only diff;
2. require the literal approval `INSTALL-MCP:<profile>`;
3. parse the existing config and preserve every unrelated entry;
4. merge only the generated server entry, retain a recoverable copy, and parse the result;
5. run client-specific discovery without exposing environment or profile internals.

Without the exact approval, stop after generating and validating the fragment.
