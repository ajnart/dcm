"use client"

import { Button } from "@/components/ui/button"
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog"
import { useClipboard } from "@/hooks/use-clipboard"
import {
  SELFHOST_SITE,
  buildSelfHostCommand,
  buildSelfHostLink,
} from "@/lib/selfhost"
import { Check, CircleHelp, Copy, ExternalLink } from "lucide-react"
import { toast } from "sonner"

interface SelfHostCommandProps {
  ids: string[]
}

export function SelfHostCommand({ ids }: SelfHostCommandProps) {
  const { copy, copied } = useClipboard()
  const command = buildSelfHostCommand(ids)

  return (
    <div className="flex min-w-0 max-w-full items-center gap-1">
      <button
        type="button"
        onClick={() =>
          copy(command).then((ok) => {
            if (!ok) toast.error("Failed to copy command")
          })
        }
        aria-label="Copy self-host command"
        className="group flex min-w-0 max-w-full items-center gap-2 rounded-md border bg-muted px-2 py-1 text-left font-mono text-foreground text-xs transition-colors hover:bg-accent"
      >
        <span className="truncate">{command}</span>
        {copied ? (
          <Check className="h-3 w-3 shrink-0 text-green-500 motion-safe:animate-scale-in" />
        ) : (
          <Copy className="h-3 w-3 shrink-0 text-muted-foreground transition-colors group-hover:text-foreground" />
        )}
      </button>
      <SelfHostInfo ids={ids} />
    </div>
  )
}

function SelfHostInfo({ ids }: SelfHostCommandProps) {
  return (
    <Dialog>
      <DialogTrigger asChild>
        <button
          type="button"
          aria-label="What is self-host?"
          className="shrink-0 rounded-full p-1 text-muted-foreground transition-colors hover:bg-accent hover:text-foreground"
        >
          <CircleHelp className="h-4 w-4" />
        </button>
      </DialogTrigger>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>What is self-host?</DialogTitle>
          <DialogDescription>
            One command-line tool that installs, wires and repairs your
            self-hosted apps with Docker Compose, so you never have to manage
            YAML.
          </DialogDescription>
        </DialogHeader>
        <ul className="list-disc space-y-2 pl-5 text-sm">
          <li>
            Pick apps, review the plan, then run them. It connects them for you:
            API keys, download clients and Homarr tiles.
          </li>
          <li>
            A terminal dashboard for people, and <code>--json</code> commands
            for AI agents.
          </li>
          <li>
            Runs on Linux and macOS (Windows through WSL) and needs Docker with
            Compose v2.
          </li>
        </ul>
        <p className="text-muted-foreground text-sm">
          It is in preview: public downloads are not available yet, but you can
          already try your selection in the browser.
        </p>
        <DialogFooter className="gap-2 sm:gap-0">
          <Button asChild variant="outline">
            <a
              href={buildSelfHostLink(ids)}
              target="_blank"
              rel="noopener noreferrer"
            >
              Try it in your browser
            </a>
          </Button>
          <Button asChild>
            <a href={SELFHOST_SITE} target="_blank" rel="noopener noreferrer">
              Learn more at self-host.fyi
              <ExternalLink />
            </a>
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
