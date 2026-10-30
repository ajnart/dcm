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
import { track } from "@/lib/analytics"
import { SELFHOST_INSTALL, SELFHOST_URL } from "@/lib/selfhost"
import { cn } from "@/lib/utils"
import { Check, CircleHelp, Copy, ExternalLink } from "lucide-react"
import { useRef } from "react"

interface SelfHostCommandProps {
  command: string | null
  ids: string[]
  prominent?: boolean
}

export function SelfHostCommand({
  command,
  ids,
  prominent = false,
}: SelfHostCommandProps) {
  const { copy, copied } = useClipboard()
  const indicatorRef = useRef<HTMLSpanElement>(null)
  const empty = command === null
  const shown = command ?? "self-host install <apps…>"

  const handleCopy = async () => {
    if (command === null) return
    const ok = await copy(command, indicatorRef.current ?? undefined)
    if (ok)
      track({
        name: "dcm_selfhost_command_copied",
        count: ids.length,
        ids,
      })
  }

  return (
    <div className="flex min-w-0 max-w-full items-center gap-1">
      <button
        type="button"
        disabled={empty}
        onClick={handleCopy}
        aria-label="Copy self-host command"
        className={cn(
          "group flex min-w-0 max-w-full items-center gap-2 border bg-muted px-2 py-1 text-left font-mono text-foreground text-xs transition-colors enabled:hover:bg-accent",
          prominent && "border-primary px-3 py-2 text-sm",
          empty && "text-muted-foreground",
        )}
      >
        <span className="text-accent-text">$</span>
        <span className="truncate">{shown}</span>
        <span ref={indicatorRef} className="flex shrink-0 items-center">
          {copied ? (
            <span
              aria-live="polite"
              className="flex items-center gap-1 text-ok motion-safe:animate-scale-in"
            >
              <Check className="h-3 w-3" />
              Copied
            </span>
          ) : (
            <Copy className="h-3 w-3 text-muted-foreground transition-colors group-hover:text-foreground" />
          )}
        </span>
      </button>
      <SelfHostInfo />
    </div>
  )
}

function SelfHostInfo() {
  return (
    <Dialog>
      <DialogTrigger asChild>
        <button
          type="button"
          aria-label="What is self-host?"
          className="shrink-0 p-1 text-muted-foreground transition-colors hover:bg-accent hover:text-foreground"
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
          Install it once, then run the command above:
        </p>
        <code className="block overflow-x-auto border bg-muted px-3 py-2 text-xs">
          {SELFHOST_INSTALL}
        </code>
        <DialogFooter className="gap-2 sm:gap-0">
          <Button asChild>
            <a href={SELFHOST_URL} target="_blank" rel="noopener noreferrer">
              Learn more at self-host.fyi
              <ExternalLink />
            </a>
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
