"use client"

import { Button } from "@/components/ui/button"
import type { DockerTool } from "@/lib/docker-tools"
import {
  buildSelfHostCommand,
  buildSelfHostLink,
  getSelfHostIds,
} from "@/lib/selfhost"
import { Check, Copy, ExternalLink } from "lucide-react"
import posthog from "posthog-js"
import { useState } from "react"

interface SelfHostCalloutProps {
  selectedTools: DockerTool[]
}

export default function SelfHostCallout({
  selectedTools,
}: SelfHostCalloutProps) {
  const [copied, setCopied] = useState(false)
  const ids = getSelfHostIds(selectedTools.map((tool) => tool.id))

  if (ids.length === 0) return null

  const command = buildSelfHostCommand(ids)
  const link = buildSelfHostLink(ids)

  const handleCopy = async () => {
    await navigator.clipboard.writeText(command)
    setCopied(true)
    posthog.capture("selfhost_command_copied", {
      source: "compose_modal",
      apps: ids,
    })
    setTimeout(() => setCopied(false), 2000)
  }

  const handleOpen = () => {
    posthog.capture("selfhost_link_clicked", {
      source: "compose_modal",
      apps: ids,
    })
    window.open(link, "_blank", "noopener,noreferrer")
  }

  return (
    <div className="mb-3 flex flex-col gap-3 rounded-md border bg-muted/40 p-3 md:flex-row md:items-center md:justify-between">
      <div className="min-w-0">
        <p className="font-medium text-sm">
          Rather not manage YAML? self-host installs and wires these for you.
        </p>
        <p className="text-muted-foreground text-xs">
          Covers {ids.length} of {selectedTools.length} selected service
          {selectedTools.length !== 1 ? "s" : ""}.
        </p>
        <button
          type="button"
          onClick={handleCopy}
          aria-label="Copy self-host command"
          className="mt-2 flex max-w-full items-center gap-2 rounded border bg-background px-2 py-1 text-left font-mono text-xs hover:bg-accent"
        >
          <span className="truncate">{command}</span>
          {copied ? (
            <Check className="h-3 w-3 shrink-0" />
          ) : (
            <Copy className="h-3 w-3 shrink-0" />
          )}
        </button>
      </div>
      <Button
        variant="outline"
        size="sm"
        className="shrink-0"
        onClick={handleOpen}
      >
        Try it in your browser
        <ExternalLink className="ml-2 h-3 w-3" />
      </Button>
    </div>
  )
}
