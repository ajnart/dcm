import Providers from "@/components/Providers"
import { CopyLabel } from "@/components/copy-label"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { useClipboard } from "@/hooks/use-clipboard"
import { track } from "@/lib/analytics"
import { routes } from "@/lib/routes"
import { SUBMISSION_ISSUE_URL, buildAgentPrompt } from "@/lib/suggest"
import { Copy, ExternalLink } from "lucide-react"
import { useEffect, useMemo, useState } from "react"

function Suggest() {
  const [name, setName] = useState("")
  const [repo, setRepo] = useState("")
  const { copy, copied } = useClipboard()
  const prompt = useMemo(() => buildAgentPrompt({ name, repo }), [name, repo])

  useEffect(() => {
    track({ name: "dcm_suggest_opened" })
  }, [])

  return (
    <div className="mx-auto max-w-3xl">
      <a
        href={routes.compose}
        className="text-accent-text text-sm hover:underline"
      >
        Docker Compose Maker
      </a>
      <h1 className="mt-2 font-bold text-3xl">Suggest a container</h1>
      <p className="mt-1 text-muted-foreground text-sm">
        Missing an app? Add it yourself with an AI coding agent, or open an
        issue and a maintainer will pick it up.
      </p>

      <section className="mt-8 space-y-4 border p-5">
        <h2 className="font-semibold text-lg">
          Have an AI coding agent (Codex, Claude Code)?
        </h2>
        <p className="text-muted-foreground text-sm">
          Fill in the app, copy the prompt and paste it into your agent. It
          clones the repository, adds the app and opens a pull request.
        </p>
        <div className="grid gap-4 sm:grid-cols-2">
          <div className="space-y-2">
            <Label htmlFor="suggest-name">App name</Label>
            <Input
              id="suggest-name"
              value={name}
              placeholder="Sonarr"
              autoComplete="off"
              onChange={(event) => setName(event.target.value)}
            />
          </div>
          <div className="space-y-2">
            <Label htmlFor="suggest-repo">Repository URL</Label>
            <Input
              id="suggest-repo"
              value={repo}
              placeholder="https://github.com/Sonarr/Sonarr"
              autoComplete="off"
              inputMode="url"
              onChange={(event) => setRepo(event.target.value)}
            />
          </div>
        </div>
        <pre className="max-h-72 overflow-auto whitespace-pre-wrap border bg-muted p-3 font-mono text-xs">
          {prompt}
        </pre>
        <Button
          type="button"
          onClick={async (event) => {
            const ok = await copy(prompt, event.currentTarget)
            if (ok) track({ name: "dcm_suggest_prompt_copied" })
          }}
        >
          <CopyLabel copied={copied} icon={<Copy />} label="Copy prompt" />
        </Button>
      </section>

      <section className="mt-6 space-y-4 border p-5">
        <h2 className="font-semibold text-lg">Open an issue</h2>
        <p className="text-muted-foreground text-sm">
          The container submission template asks for the image, the compose
          service and the icon. Once a maintainer accepts it, a workflow opens
          the pull request for you.
        </p>
        <Button asChild variant="outline">
          <a
            href={SUBMISSION_ISSUE_URL}
            target="_blank"
            rel="noopener noreferrer"
            onClick={() => track({ name: "dcm_suggest_issue_opened" })}
          >
            Open the submission template
            <ExternalLink />
          </a>
        </Button>
      </section>
    </div>
  )
}

export default function SuggestClient() {
  return (
    <Providers>
      <Suggest />
    </Providers>
  )
}
