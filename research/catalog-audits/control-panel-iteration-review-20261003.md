# Control-panel iteration review — 2026-10-03

Source-only review against the supplied outcome-first specification. No tests,
Docker, browser, private project state, credentials or external APIs inspected.
Existing shared Compose ownership, per-app credential extraction, dependency
ordering and bounded parallel first-run execution are useful foundations; this
is not a recommendation to replace them. HTTPS and derived-metadata issues are
outside this review.

## 1. The primary CLI journey still requires app selection

The main menu prioritizes “Select apps for a new project”; the shared picker
initializes every recipe as unselected, including Homarr. Goal planning is a
different flow whose personal-media branch redirects to the legacy installer.
Thus “I want Netflix” does not feed the default shared deployment journey, and
the basic front door is not a default. The public skill recommends goals and
Homarr, but that orchestration currently depends on the agent.

Sources: [main menu](../../packages/cli/src/interactive.ts#L4631),
[shared picker](../../packages/cli/src/control-panel/shared-create.ts#L55),
[goal flow](../../packages/cli/src/interactive.ts#L660),
[skill](../../.agents/skills/self-host/SKILL.md),
[conversation contract](../../.agents/skills/self-host/workflows/selfhost/references/conversation.md).

Smallest change: accept resolved initial app IDs in `createSharedProject`, seed
them from the existing catalog goal plan, include Homarr unless explicitly
declined, and make the picker an optional customization screen. Reject missing
recipes as a named capability gap; do not fall back to another Compose owner.

## 2. Existing library/root-folder setup cannot be reached from the panel

`runSharedFirstRun` never collects or forwards `--input`. Jellyfin already
declares Movies/Shows paths, but its adapter considers the narrower
administrator/API-key-only record `ready` even when libraries are explicitly
unconfigured. Sonarr/Radarr likewise declare optional root-folder paths. A user
can finish the terminal first-run loop without the libraries required for the
requested media outcome, even though deterministic implementation exists.

Sources: [panel setup arguments](../../packages/cli/src/control-panel/shared-create.ts#L249),
[Jellyfin inputs/readiness](../../.agents/skills/self-host/workflows/selfhost/references/catalog/apps/jellyfin/setup.ts#L390),
[Sonarr input](../../.agents/skills/self-host/workflows/selfhost/references/catalog/apps/sonarr/setup.ts#L189),
[input validation](../../packages/cli/src/control-panel/setup-engine.ts#L129),
[shared setup review](../../packages/cli/src/shared-project.ts#L1178).

Smallest change: expose adapter input definitions in setup review, resolve known
capability path defaults once, collect only genuinely missing owner choices,
then include identical input arguments in both review and every approved retry.
Keep `ready` as first-run readiness, but surface unmet capability requirements
separately rather than silently treating credential creation as usable media.
This is the highest-value bounded next implementation: it reaches already-built
deterministic setup without adding a new orchestrator or duplicating an adapter.

## 3. Failure details and unfinished acceptance disappear at handoff

The engine returns sanitized `detail` for deferred/failed steps. The terminal
recap prints only app ID/state and returns `void`; its caller continues to
Homarr publication and the generic saved-project outro regardless of those
outcomes. Successful publication then displays “View dashboard” without running
`homarr-status --live`, while the setup guide requires board/recap and live checks
before handoff. The panel does disclose some acceptance limits, but neither
attempts a contract-supported fallback nor preserves the concrete next action
in its final result. “Data is preserved on restart” is not a measured persistence
result.

Sources: [engine failure detail](../../packages/cli/src/control-panel/setup-engine.ts#L372),
[discarded details](../../packages/cli/src/control-panel/shared-create.ts#L274),
[unconditional continuation](../../packages/cli/src/control-panel/shared-create.ts#L119),
[dashboard handoff](../../packages/cli/src/control-panel/shared-create.ts#L339),
[completion/fallback contract](../../.agents/skills/self-host/workflows/selfhost-setup/GUIDE.md).

Smallest change: return structured first-run outcomes; carry each incomplete
app's sanitized detail and exact recovery command into one final recap; run the
existing read-only dashboard status before offering its primary link. Report
capability acceptance as pending unless direct evidence exists. Expose only
documented owner-compatible fallback requests to the optional skill—no generic
browser repair, manual key copying or automatic mutation beyond approval.

Independent actions already run concurrently in the core. The panel currently
selects only `pendingSteps[0]` for each approval round; reviewing the full current
set together would reduce repeated prompts while retaining each exact token.
Do not preapprove undiscovered writes.

## Implemented follow-up

The same iteration now preselects optional Homarr for fresh shared projects,
exposes declared non-secret setup inputs, and retains those choices across
review/retry. The panel reviews the complete current approval batch and displays
sanitized first-run outcome details. Dashboard publication and the recap action
now request live widget-data checks; resource creation is reported separately
from functional success. Focused input/batch and live-recap fixtures passed.

Still pending: outcome-to-shared-selection routing, a structured final recovery
handoff, and actual live new/existing-project acceptance of these panel changes.
The original findings above describe the reviewed baseline, not those fixes.
