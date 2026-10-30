import { ModeToggle } from "@/components/ModeToggle"
import Providers from "@/components/Providers"
import ToolGrid from "@/components/ToolGrid"
import DiscoveryPanel from "@/components/discovery-panel"
import FloatingBar from "@/components/floating-bar"
import SettingsPanel from "@/components/settings-panel"
import { Button } from "@/components/ui/button"
import { useMode } from "@/hooks/use-mode"
import { useSelection } from "@/hooks/use-selection"
import { withBase } from "@/lib/base"
import { type Catalog, type CatalogMode, entriesForMode } from "@/lib/catalog"
import { SELFHOST_URL } from "@/lib/selfhost"
import { decodeShareUrl } from "@/lib/url-utils"
import { Palette } from "lucide-react"
import { useEffect, useMemo, useRef } from "react"

interface DockerToolsClientProps {
  catalog: Catalog
}

const INTRO: Record<CatalogMode, string> = {
  "self-host":
    "Pick apps, then run one self-host command. Prefer plain YAML? Copy the Compose file instead.",
  all: "Every container DCM knows about. Apps with a self-host badge install with one command.",
}

function DockerTools({ catalog }: DockerToolsClientProps) {
  const [mode, setMode] = useMode()
  const selection = useSelection()
  const processedShareRef = useRef(false)

  const entries = useMemo(() => entriesForMode(catalog, mode), [catalog, mode])
  const counts = useMemo(
    () => ({
      "self-host": entriesForMode(catalog, "self-host").length,
      all: catalog.entries.length,
    }),
    [catalog],
  )

  useEffect(() => {
    if (processedShareRef.current) return
    const url = new URL(window.location.href)
    const share = url.searchParams.get("share")
    if (!share) return
    processedShareRef.current = true

    const ids = decodeShareUrl(share)
    selection.set(ids)

    const selfHostIds = new Set(
      entriesForMode(catalog, "self-host").map((entry) => entry.id),
    )
    url.searchParams.delete("share")
    window.history.replaceState(window.history.state, "", url)
    if (ids.some((id) => !selfHostIds.has(id))) setMode("all")
  }, [catalog, selection.set, setMode])

  const toggle = (id: string) => {
    const entry = catalog.entries.find((item) => item.id === id)
    if (entry?.isUnsupported) return
    selection.toggle(id)
  }

  return (
    <>
      <div className="mb-6 flex flex-wrap items-start justify-between gap-4">
        <div>
          <h1 className="font-bold text-3xl">Docker Compose Maker</h1>
          <p className="mt-1 max-w-2xl text-muted-foreground text-sm">
            {INTRO[mode]}{" "}
            <a
              href={SELFHOST_URL}
              target="_blank"
              rel="noopener noreferrer"
              className="font-medium text-accent-text hover:underline"
            >
              What is self-host?
            </a>
          </p>
        </div>
        <Button asChild className="flex items-center gap-2">
          <a href={withBase("/templates")}>
            <Palette size={16} />
            Template Gallery
          </a>
        </Button>
      </div>

      <div className="mb-6">
        <ModeToggle mode={mode} counts={counts} onChange={setMode} />
      </div>

      <div className="[animation-delay:300ms] motion-safe:animate-slide-down">
        <SettingsPanel />
      </div>

      <div className="[animation-delay:450ms] motion-safe:animate-slide-down">
        <DiscoveryPanel />
      </div>

      <FloatingBar
        catalog={catalog}
        entries={entries}
        mode={mode}
        ids={selection.ids}
        onToggle={toggle}
        onClear={selection.clear}
      />

      <ToolGrid
        entries={entries}
        selected={selection.ids}
        onToggle={toggle}
        selfHostBadge={mode === "all"}
      />
    </>
  )
}

export default function DockerToolsClient(props: DockerToolsClientProps) {
  return (
    <Providers>
      <DockerTools {...props} />
    </Providers>
  )
}
