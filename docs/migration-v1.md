# Migrating to v1

Version 1.0 establishes the first public command and package contract. Existing
`.selfhost/project.json` and `.selfhost/preferences.json` schema-v1 documents
remain valid and separate.

## Command mapping

| Pre-v1 command | v1 command |
| --- | --- |
| `stack resolve <goal>` | `plan <goal> --project-root PATH` |
| `stack plan <goal>` | `plan <goal> --project-root PATH` |
| `project status --project-root PATH` | `plan --project-root PATH` |
| `project resume --project-root PATH` | `plan --project-root PATH` |
| `project init <goal...>` | `state init <goal...> --project-root PATH` |
| `project revise <goal...>` | `state revise <goal...> --project-root PATH` |
| `project checkpoint <stage>` | `state checkpoint <inspected\|planned\|applied\|verified> --project-root PATH` |

Catalog and preference data remain unchanged. The v1 JSON envelope adds stable
status, mutation, decision, limitation, and summary fields around command data.

Pre-v1 aliases are removed rather than retained as a second command surface.
The project root is now mandatory so saved state and preferences have one
explicit owner. Replace a legacy `--preferences FILE` argument by placing the
validated schema-v1 preferences at `PATH/.selfhost/preferences.json`. Update
scripts to use the v1 forms before adopting the public release.
