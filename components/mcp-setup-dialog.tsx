"use client"

import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog"
import {
  AlertCircle,
  Box,
  Check,
  Copy,
  FileCode2,
  LayoutTemplate,
  Plug,
} from "lucide-react"
import { useEffect, useRef, useState } from "react"

const DEFAULT_ORIGIN = "https://compose.ajnart.dev"

const MCP_ENDPOINTS = [
  {
    key: "dcm-tools",
    title: "Container tools",
    path: "/api/mcp/v2/tools",
    description: "Discover supported containers and inspect their details.",
    tools: ["list_docker_tools", "get_docker_tool"],
    icon: Box,
  },
  {
    key: "dcm-templates",
    title: "Templates",
    path: "/api/mcp/v2/templates",
    description: "Browse curated stacks and retrieve complete templates.",
    tools: ["list_templates", "get_template"],
    icon: LayoutTemplate,
  },
  {
    key: "dcm-compose",
    title: "Compose generation",
    path: "/api/mcp/v2/compose",
    description: "Generate Docker Compose and .env output from selected tools.",
    tools: ["generate_compose"],
    icon: FileCode2,
  },
] as const

type CopyState = "idle" | "success" | "error"

/** Generate the MCP client configuration for the active deployment origin. */
function createMcpConfig(origin: string) {
  const mcpServers = Object.fromEntries(
    MCP_ENDPOINTS.map((endpoint) => [
      endpoint.key,
      { url: `${origin}${endpoint.path}` },
    ]),
  )

  return JSON.stringify({ mcpServers }, null, 2)
}

/** Render clipboard feedback for the generated MCP client configuration. */
function CopyButton({ value }: { value: string }) {
  const [copyState, setCopyState] = useState<CopyState>("idle")
  const resetTimer = useRef<ReturnType<typeof setTimeout> | null>(null)

  useEffect(() => {
    return () => {
      if (resetTimer.current) clearTimeout(resetTimer.current)
    }
  }, [])

  /** Copy the generated configuration and expose the result to assistive tech. */
  const handleCopy = async () => {
    if (resetTimer.current) clearTimeout(resetTimer.current)

    try {
      await navigator.clipboard.writeText(value)
      setCopyState("success")
    } catch {
      setCopyState("error")
    }

    resetTimer.current = setTimeout(() => setCopyState("idle"), 3000)
  }

  let buttonLabel = "Copy config"
  let statusMessage = ""
  let ButtonIcon = Copy

  if (copyState === "success") {
    buttonLabel = "Copied"
    statusMessage = "Configuration copied to your clipboard."
    ButtonIcon = Check
  }

  if (copyState === "error") {
    buttonLabel = "Copy failed"
    statusMessage =
      "Could not access the clipboard. Select and copy the JSON manually."
    ButtonIcon = AlertCircle
  }

  return (
    <div className="flex min-h-9 items-center gap-3">
      <Button
        type="button"
        size="sm"
        variant="secondary"
        className="border border-zinc-700 bg-zinc-100 text-zinc-950 shadow-sm hover:bg-white focus-visible:ring-zinc-300"
        onClick={handleCopy}
      >
        <ButtonIcon aria-hidden="true" />
        {buttonLabel}
      </Button>
      <output aria-live="polite" className="text-muted-foreground text-xs">
        {statusMessage}
      </output>
    </div>
  )
}

/** Advertise the MCP endpoints and help users configure an AI client. */
export function McpSetupDialog() {
  const [origin, setOrigin] = useState(DEFAULT_ORIGIN)

  useEffect(() => {
    setOrigin(window.location.origin)
  }, [])

  const config = createMcpConfig(origin)

  return (
    <Dialog>
      <DialogTrigger asChild>
        <button
          type="button"
          className="px-2 py-1 text-muted-foreground text-sm transition-colors hover:text-pink"
        >
          MCP
        </button>
      </DialogTrigger>

      <DialogContent className="max-h-[92vh] w-[calc(100vw-1.5rem)] max-w-5xl gap-0 overflow-y-auto p-0 sm:w-full">
        <DialogHeader className="border-b bg-muted/30 px-5 py-5 pr-14 text-left sm:px-6">
          <div className="flex items-start gap-3">
            <div className="flex h-11 w-11 shrink-0 items-center justify-center rounded-lg bg-primary/10 ring-1 ring-primary/20">
              <Plug className="h-5 w-5 text-primary" aria-hidden="true" />
            </div>
            <div className="min-w-0 space-y-1">
              <div className="flex flex-wrap items-center gap-2">
                <DialogTitle className="text-xl leading-tight">
                  Connect DCM to your AI client
                </DialogTitle>
                <Badge variant="secondary">MCP v2 · 3 stateless servers</Badge>
              </div>
              <DialogDescription className="max-w-2xl leading-relaxed">
                Discover containers and templates, then generate Compose files
                without leaving your MCP-compatible client.
              </DialogDescription>
            </div>
          </div>
        </DialogHeader>

        <div className="grid lg:grid-cols-[minmax(0,1fr)_19rem]">
          <section
            aria-labelledby="mcp-config-heading"
            className="min-w-0 space-y-4 p-5 sm:p-6"
          >
            <div className="space-y-1">
              <h3 id="mcp-config-heading" className="font-semibold text-sm">
                Add all three servers
              </h3>
              <p className="text-muted-foreground text-xs leading-relaxed">
                Paste this JSON into your client&apos;s MCP configuration. The
                URLs automatically match this DCM deployment.
              </p>
            </div>

            <div className="overflow-hidden rounded-lg border border-zinc-800 bg-zinc-950 shadow-inner">
              <div className="flex items-center justify-between border-zinc-800 border-b px-4 py-2.5">
                <span className="font-mono text-xs text-zinc-400">
                  mcp.json
                </span>
                <Badge className="border-zinc-700 bg-zinc-900 text-zinc-300 hover:bg-zinc-900">
                  Streamable HTTP
                </Badge>
              </div>
              <textarea
                aria-label="MCP JSON configuration"
                className="h-72 w-full resize-none bg-zinc-950 p-4 font-mono text-xs text-zinc-100 leading-6 outline-none focus-visible:ring-2 focus-visible:ring-primary focus-visible:ring-inset"
                readOnly
                spellCheck={false}
                value={config}
              />
              <div className="border-zinc-800 border-t bg-zinc-900/70 px-4 py-3">
                <CopyButton value={config} />
              </div>
            </div>

            <div className="space-y-1.5 rounded-md border border-primary/20 bg-primary/5 px-4 py-3 text-muted-foreground text-xs leading-relaxed">
              <p className="font-semibold text-foreground">Deployment note</p>
              <p>
                These URLs require the Cloudflare Pages Functions deployment.
                Static Docker and GitHub Pages builds do not serve MCP routes.
              </p>
              <p>
                If{" "}
                <code className="font-mono text-foreground">
                  MCP_ACCESS_TOKEN
                </code>{" "}
                is enabled, add{" "}
                <code className="font-mono text-foreground">
                  Authorization: Bearer &lt;token&gt;
                </code>{" "}
                in your client.
              </p>
            </div>

            <div className="rounded-md border bg-muted/30 px-4 py-3 text-muted-foreground text-xs leading-relaxed">
              Each endpoint is independent and stateless. Clients can connect
              only the capabilities they need, or use the full configuration
              above.
            </div>
          </section>

          <aside
            aria-label="MCP endpoints and capabilities"
            className="space-y-4 border-t bg-muted/25 p-5 sm:p-6 lg:border-t-0 lg:border-l"
          >
            <div className="space-y-1">
              <h3 className="font-semibold text-sm">Available endpoints</h3>
              <p className="text-muted-foreground text-xs leading-relaxed">
                Ready as soon as your client connects.
              </p>
            </div>

            <ul className="space-y-3">
              {MCP_ENDPOINTS.map((endpoint) => {
                const EndpointIcon = endpoint.icon

                return (
                  <li
                    key={endpoint.key}
                    className="rounded-lg border bg-background/80 p-3 shadow-sm"
                  >
                    <div className="flex items-start gap-3">
                      <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-md bg-primary/10 ring-1 ring-primary/15">
                        <EndpointIcon
                          className="h-4 w-4 text-primary"
                          aria-hidden="true"
                        />
                      </div>
                      <div className="min-w-0 space-y-1.5">
                        <p className="font-semibold text-sm leading-none">
                          {endpoint.title}
                        </p>
                        <code className="block break-all text-[11px] text-primary">
                          {origin}
                          {endpoint.path}
                        </code>
                        <p className="text-muted-foreground text-xs leading-relaxed">
                          {endpoint.description}
                        </p>
                      </div>
                    </div>
                    <div className="mt-3 flex flex-wrap gap-1.5">
                      {endpoint.tools.map((tool) => (
                        <Badge
                          key={tool}
                          variant="outline"
                          className="font-mono font-normal text-[10px]"
                        >
                          {tool}
                        </Badge>
                      ))}
                    </div>
                  </li>
                )
              })}
            </ul>
          </aside>
        </div>
      </DialogContent>
    </Dialog>
  )
}
