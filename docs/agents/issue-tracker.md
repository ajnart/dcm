# Issue tracker: GitHub

Issues and specs live in GitHub Issues for `ajnart/self-host`.
Use the `gh` CLI from this checkout.

## Operations

- Create: `gh issue create --title "..." --body-file <path>`.
- Read: `gh issue view <number> --comments`; include labels when relevant.
- List: `gh issue list --state open --json number,title,body,labels,comments`.
  Add label and state filters as needed.
- Comment: `gh issue comment <number> --body-file <path>`.
- Label: `gh issue edit <number> --add-label "..." --remove-label "..."`.
- Close: `gh issue close <number> --comment "..."`.

Publishing to the issue tracker means creating a GitHub issue.
Fetching a ticket means reading its issue and comments.

## Pull requests as a triage surface

**PRs as a request surface: no.**

If enabled later, use the corresponding `gh pr` operations and include
external contributors, excluding owners, members, and collaborators.
GitHub shares issue and PR numbers; resolve ambiguous references with
`gh pr view <number>`, falling back to `gh issue view <number>`.

## Wayfinding

- Map: one issue labelled `wayfinder:map`, containing Notes,
  Decisions-so-far, and Fog.
- Children: GitHub sub-issues labelled `wayfinder:<type>`:
  research, prototype, grilling, or task.
  If sub-issues are unavailable, use a task list in the map and
  `Part of #<map>` in each child.
- Blocking: use native issue dependencies. Retrieve the blocker's
  database ID with `gh api repos/ajnart/self-host/issues/<n> --jq .id`,
  then POST it as `issue_id` to
  `repos/ajnart/self-host/issues/<child>/dependencies/blocked_by`.
  If unavailable, use `Blocked by: #<n>` in the child body.
- Frontier: the first open child in map order with no open blockers
  and no assignee.
- Claim: `gh issue edit <number> --add-assignee @me`.
- Resolve: comment with the answer, close the child, and add its
  context pointer to the map's Decisions-so-far.
