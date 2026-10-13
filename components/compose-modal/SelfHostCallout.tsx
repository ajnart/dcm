"use client"

import { useClipboard } from "@/hooks/use-clipboard"
import { buildSelfHostCommand, buildSelfHostLink } from "@/lib/selfhost"
import { Check, Copy, ExternalLink } from "lucide-react"

interface SelfHostCalloutProps {
  ids: string[]
  yamlMissing?: { name: string }[]
}

export default function SelfHostCallout({
  ids,
  yamlMissing = [],
}: SelfHostCalloutProps) {
  const { copy, copied } = useClipboard()

  if (ids.length === 0) return null

  const command = buildSelfHostCommand(ids)
  const lead =
    yamlMissing.length > 0
      ? `No YAML for ${yamlMissing.map((entry) => entry.name).join(", ")}? The self-host preview covers it:`
      : "Rather not manage YAML? Try the self-host preview:"

  return (
    <div className="mt-2 flex min-w-0 flex-wrap items-center gap-2 text-muted-foreground text-sm sm:mt-0 sm:mr-auto">
      <span>{lead}</span>
      <button
        type="button"
        onClick={() => copy(command)}
        aria-label="Copy self-host command"
        className="flex min-w-0 max-w-full items-center gap-2 rounded-md border bg-muted px-2 py-1 text-left font-mono text-foreground text-xs transition-colors hover:bg-accent"
      >
        <span className="truncate">{command}</span>
        {copied ? (
          <Check className="h-3 w-3 shrink-0" />
        ) : (
          <Copy className="h-3 w-3 shrink-0" />
        )}
      </button>
      <a
        href={buildSelfHostLink(ids)}
        target="_blank"
        rel="noopener noreferrer"
        className="inline-flex items-center gap-1 transition-colors hover:text-primary hover:underline"
      >
        Try it in your browser
        <ExternalLink className="h-3 w-3" />
      </a>
    </div>
  )
}
