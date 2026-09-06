# Stack lifecycle contract

`.selfhost/stack.json` is the private continuation record shared by setup and
upkeep. It stores selected profiles, their resolved skills, service ownership,
one adapter runtime pointer, and typed checkpoint evidence. It stores no secret
value.

The install profile manifest declares whether each profile has no service
consumption or requires explicit bindings, plus the exact `approval:` and
`verify:` evidence IDs it requires. `.selfhost/stack.json` records each binding
as one profile ID with a sorted non-empty list of existing service IDs. Create
them with repeated `--consume PROFILE=SERVICE`; an unrelated service record
cannot implicitly satisfy an extension. Resolved obligations are additive:
selecting a pack or extension retains every `basic` obligation and adds only
its own.

For the media pack, `connections.path` points to the adapter-owned mode-`0600`
`connections.env`. That file may contain local URLs, usernames, and API keys so
later extensions can wire services without repeating onboarding. It never
contains the generated admin password. The setup-time `handoff` command derives
it; the agent tells the user that password directly in the final setup handoff
without retaining it.

## Transitions

```text
selected -> planned -> applied -> verified
```

- `init` records selected profiles before apply.
- `extend` adds one or more profiles and returns to `selected` without removing
  existing service records.
- `planned` requires new `plan:` evidence. `applied` requires new `apply:` or
  `manifest:` evidence plus every selected profile's `approval:` IDs.
  `verified` requires every selected profile's declared `verify:` IDs; the
  media pack names all seven services, browser proof, and relationship proof.
- Repeating a stage is allowed only to append fresh evidence.

Every write uses the private `.selfhost` directory, a no-follow update lock,
an exclusive stale-lock recovery claim, mode `0600`, atomic replacement, and
the existing wildcard `.gitignore`. A live owner is never displaced based on
age; an interrupted recovery claim fails closed for manual inspection.
Commands return metadata and connection paths but never emit API keys.
Before `applied`, `resume` reports recorded adapter connection state as pending
so an interrupted setup can continue before the runtime or file exists. At
`applied` and `verified`, it delegates connection-file validation to the
recorded adapter and returns only its pass/fail classification; upkeep never
receives file contents.
