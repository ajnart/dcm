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

1. Clone ${REPO_URL} and read AGENTS.md and docs/agents/dcm.md before changing anything.
2. Pick where ${app} belongs:
   - A DCM-only Container: add a definition in dcm/src/tools with a test, and validate the generated compose (bun run --cwd dcm test:compose).
   - A self-host App: add it in internal/apps following the App contract in internal/app. Declare its icon in tools/sitegen, add a StandaloneGuide if the plain Compose needs manual steps, then run go run ./tools/sitegen.
3. Run the gates in AGENTS.md for what you touched.
4. Open a pull request with gh pr create.`
}
