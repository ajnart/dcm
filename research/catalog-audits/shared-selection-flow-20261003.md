# Shared selection flow — 2026-10-03

Source-only audit and bounded implementation. No Docker, credentials, service
state or CI inspected. Synthetic fixture is not live removal acceptance.

Before: the shared menu had an additions-only picker and exact start/stop, but
no searchable view of the complete installed selection. The existing legacy
selection path invokes standalone owners and saves a separate exclusion ledger;
using it for shared apps would violate their Compose ownership boundary.

Sources: [shared menu](../../packages/cli/src/control-panel/flow.ts),
[legacy selection](../../packages/cli/src/control-panel/flow.ts),
[shared add helper](../../packages/cli/src/control-panel/shared-create.ts),
[upkeep owner](../../.agents/skills/self-host/workflows/selfhost-upkeep/GUIDE.md).

Implemented: shared **Change app selection** reuses `catalog-picker` and
`selectionPlan`, preselects installed units, disables discovery-only choices,
and keeps available image updates informational. It routes removals through
the generic shared engine's exact reviewed `remove` boundary and additions
through the existing seeded `addSharedProjectApps` helper. Existing app
start/stop remains independent; retaining an app does not implicitly start it.
No second command router, standalone owner or exclusion state is introduced.

Removal requires exact root/project/app identity, services, retained apps,
data/credential preservation assertions and a fresh approval. Declined removal
blocks subsequent additions. Removal and addition are separately approved, not
an atomic transaction; partial changes remain visible. Dependency refusal and
the actual data-preserving Compose removal belong to the generic engine.
The UI does not remove Homarr resources or claim app function, connection or
restart acceptance after selection changes.

Engine reconciliation: removal apply uses its explicit `--apply --approval`
contract. Engine review blockers (including last-unit retirement) are displayed
and stop the selection before any additions. An uncertain apply stops additions
and directs checkpoint inspection. Shared selection never accesses the legacy
exclusion ledger.

Focused validation: `packages/cli/tests/shared-selection-panel.test.ts` uses
synthetic prompts/CLI reports only. It checks full selection defaults,
discovery-only restrictions, exact removal selection/approval, seeded additions,
cancelled reviews, wrong-owner rejection, dependency/last-unit blockers,
exclusion-ledger isolation and unchanged-selection no-op.
