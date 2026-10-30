export const REPO_URL = "https://github.com/ajnart/self-host"

export const SUBMISSION_ISSUE_URL = `${REPO_URL}/issues/new?template=dcm-container-submission.yml`

export interface SuggestDraft {
  name: string
  repo: string
}

export function buildAgentPrompt({ name, repo }: SuggestDraft): string {
  const app = name.trim() || "<app name>"
  const source = repo.trim() || "<repository URL>"
  return `Add ${app} (${source}) to self-host.

1. Fork and clone the repository with gh repo fork ajnart/self-host --clone, then read AGENTS.md before changing anything.
2. Load .claude/skills/add-container/SKILL.md for a DCM-only Container, or .claude/skills/edit-catalog/SKILL.md for a Catalog App, and follow it.
3. Run the gates in AGENTS.md for what you touched.
4. Open a pull request with gh pr create.`
}
