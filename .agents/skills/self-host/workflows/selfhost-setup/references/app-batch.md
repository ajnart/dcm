# Mixed app batch

Use this path only when `self-host catalog recipes --json` confirms each
explicitly selected app has `recipeCapability.boundedApply: true`, and the
planner's `workflow.jobs` contains one independent `app-ID` job per selected
recipe and no other app job.
Implicit database or broker catalog records may be owned inside a selected
multi-service recipe; follow `setupStages`, not the raw `selectedApps` count.
Keep media, goals with extra stages, and external catalogs on their owners.

If Homarr is selected, require the exact `dashboard` stage before app jobs and
`homarr-attachments` afterward. Install or resume the one standalone Homarr
project with its own `app plan`, `app apply`, and `app onboard` approvals. Read
`app status --id homarr --live --json`; proceed only when it reports the
applied, onboarded, running project and its owned bridge. An incomplete or
uncertain checkpoint goes through Homarr's own recovery path. Homarr off needs
no dashboard stage.

For each selected app, inspect its absent or saved `app status` first. A fresh
batch accepts only new app projects. Review distinct private host ports, one
data parent, and Immich's first-admin identity when selected. Run `self-host
app batch plan --project-root ROOT --app ID=PORT --app ID=PORT
(--connect-homarr|--without-homarr) --json`, adding the same optional
`--data-parent`, `--email immich=EMAIL`, and `--name immich=NAME` throughout.
Review every returned app plan, pinned image, project, port, path, ownership,
`catalogPlanId`, `catalogWorkflow.jobs`, `jobs[].needs`, individual approval, and `BATCH:` approval.
The CLI obtains the graph from the bundled catalog, checks supported owners and gates,
and binds it to the batch approval. `dashboard` is complete only after the exact
live/onboarded Homarr check; `homarr-attachments` stays a separate later stage.
Connected mode
must name the exact saved Homarr project and bridge. One explicit confirmation
may approve the displayed set of exact app plans and batch digest together;
the CLI still checks every app token and the batch token.

Run the returned `applyArgs` as exact argv, or copy `applyCommand` on a POSIX
shell. It includes the same selection, pinned images, each app approval, and
the batch approval. The CLI re-inspects before mutation and records its
owner-only version-3 ledger with the approved catalog graph and exact pending-job
resume inputs. Read `app batch status --project-root ROOT --json` afterward; it infers the saved mode and
returns that saved graph as approval history. A legacy version-1 ledger remains
readable but has no graph snapshot. Status does not re-check the current catalog.
`recorded` means ledger and saved app states agree,
not that accounts, function, persistence, or Homarr content passed. For
`needs-inspection`, inspect the exact app and Homarr checkpoints and use
separately approved recovery. Never replay an attempted batch apply.
After an interrupted apply or separate recovery, `app batch status` checks the
original app approval, image, port, project, Homarr bridge, and running owned
runtime for historically incomplete jobs. If all jobs now match, it reports
`recovered-unverified` and
lists `recoveredJobs` without rewriting the batch ledger or claiming app
acceptance. A stopped, mismatched, or uninspectable job remains
`needs-inspection`.

In the TUI, a partial batch may continue account and acceptance checks only
for jobs whose original approval and running resources match on fresh batch
status. Ask before continuing those apps; keep failed jobs and Homarr needing
inspection untouched.

For a connected app, first check `app status --live` for the exact running
Homarr bridge. Then create owner-only `app homarr-input` and separately
review/apply/read back `homarr attach` for its tile and Notebook. Mark account,
function, persistence, backup, and browser-route checks unfinished until their
owners prove them. A tile does not prove an integration, widget, or rendered
board. Finish each app's onboarding and acceptance, then verify supported
integrations/widgets through their owners before reporting **View dashboard**.
For Homarr-off batches, recap app URLs, service purposes, credential handoff
paths, recovery status, and unfinished acceptance without a dashboard claim.
