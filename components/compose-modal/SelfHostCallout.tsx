"use client"

import { Button } from "@/components/ui/button"
import { buildSelfHostCommand, buildSelfHostLink } from "@/lib/selfhost"
import { Check, Copy, ExternalLink } from "lucide-react"
import { useState } from "react"

interface SelfHostCalloutProps {
  ids: string[]
  yamlMissing?: { name: string }[]
}

export default function SelfHostCallout({
  ids,
  yamlMissing = [],
}: SelfHostCalloutProps) {
  const [copied, setCopied] = useState(false)

  if (ids.length === 0) return null

  const command = buildSelfHostCommand(ids)

  const handleCopy = async () => {
    await navigator.clipboard.writeText(command)
    setCopied(true)
    setTimeout(() => setCopied(false), 2000)
  }

  return (
    <div className="mb-3 flex flex-col gap-3 border border-pink/50 bg-deep p-3 md:flex-row md:items-center md:justify-between">
      <div className="min-w-0">
        <p className="font-bold text-sm">
          Rather not manage YAML? self-host installs and wires these for you.
        </p>
        {yamlMissing.length > 0 && (
          <p className="text-muted-foreground text-xs">
            No YAML here for {yamlMissing.map((entry) => entry.name).join(", ")}
            : self-host covers {yamlMissing.length === 1 ? "it" : "them"}.
          </p>
        )}
        <button
          type="button"
          onClick={handleCopy}
          aria-label="Copy self-host command"
          className="mt-2 flex max-w-full items-center gap-2 border border-line bg-bg px-2 py-1 text-left text-cyan text-xs hover:border-pink"
        >
          <span className="text-pink">$</span>
          <span className="truncate">{command}</span>
          {copied ? (
            <Check className="h-3 w-3 shrink-0" />
          ) : (
            <Copy className="h-3 w-3 shrink-0" />
          )}
        </button>
      </div>
      <Button asChild variant="outline" size="sm" className="shrink-0">
        <a
          href={buildSelfHostLink(ids)}
          target="_blank"
          rel="noopener noreferrer"
        >
          Try it in your browser
          <ExternalLink className="ml-2 h-3 w-3" />
        </a>
      </Button>
    </div>
  )
}
