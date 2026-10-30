"use client"

import ToolGrid from "@/components/ToolGrid"
import DiscoveryPanel from "@/components/discovery-panel"
import FloatingBar from "@/components/floating-bar"
import SettingsPanel from "@/components/settings-panel"
import { Button } from "@/components/ui/button"
import { useSelection } from "@/hooks/use-selection"
import type { Catalog } from "@/lib/catalog"
import { buildSelfHostLink } from "@/lib/selfhost"
import { decodeShareUrl } from "@/lib/url-utils"
import { Palette } from "lucide-react"
import Link from "next/link"
import { useRouter, useSearchParams } from "next/navigation"
import { useEffect, useRef } from "react"

interface DockerToolsClientProps {
  catalog: Catalog
}

export default function DockerToolsClient({ catalog }: DockerToolsClientProps) {
  const router = useRouter()
  const searchParams = useSearchParams()
  const processedShareRef = useRef(false)
  const selection = useSelection()

  const shareParam = searchParams.get("share")

  useEffect(() => {
    if (!shareParam || processedShareRef.current) return
    processedShareRef.current = true
    selection.set(decodeShareUrl(shareParam))
    router.push("/")
  }, [shareParam, selection.set, router])

  const toggle = (id: string) => {
    const entry = catalog.entries.find((item) => item.id === id)
    if (entry?.isUnsupported) return
    selection.toggle(id)
  }

  const selected = shareParam ? decodeShareUrl(shareParam) : selection.ids

  return (
    <>
      <div className="mb-6 flex items-center justify-between">
        <div>
          <h1 className="font-bold text-3xl">Docker Compose Maker</h1>
          <p className="mt-1 text-muted-foreground text-sm">
            Rather not manage YAML?{" "}
            <a
              href={buildSelfHostLink()}
              target="_blank"
              rel="noopener noreferrer"
              className="font-medium text-primary hover:underline"
            >
              self-host
            </a>{" "}
            (preview) installs and wires these for you.
          </p>
        </div>
        <Button asChild className="flex items-center gap-2">
          <Link prefetch={false} href="/templates">
            <Palette size={16} />
            Template Gallery
          </Link>
        </Button>
      </div>

      <div className="[animation-delay:300ms] motion-safe:animate-slide-down">
        <SettingsPanel />
      </div>

      <div className="[animation-delay:450ms] motion-safe:animate-slide-down">
        <DiscoveryPanel />
      </div>

      <FloatingBar
        catalog={catalog}
        ids={selected}
        onToggle={toggle}
        onClear={selection.clear}
      />

      <ToolGrid
        entries={catalog.entries}
        selected={selected}
        onToggle={toggle}
      />
    </>
  )
}
