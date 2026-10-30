import { ModeToggle } from "@/components/ModeToggle"
import Providers from "@/components/Providers"
import ToolGrid from "@/components/ToolGrid"
import DiscoveryPanel from "@/components/discovery-panel"
import FloatingBar from "@/components/floating-bar"
import SettingsPanel from "@/components/settings-panel"
import { Button } from "@/components/ui/button"
import { useCatalogView } from "@/hooks/use-catalog-view"
import { type Catalog, entriesForMode } from "@/lib/catalog"
import type { CatalogMode } from "@/lib/modes"
import { routes } from "@/lib/routes"
import { SELFHOST_URL } from "@/lib/selfhost"
import { decodeShareUrl } from "@/lib/url-utils"
import { Palette } from "lucide-react"
import { useEffect, useMemo, useRef } from "react"

interface DockerToolsClientProps {
  catalog: Catalog
  mode: CatalogMode
}

const TITLE: Record<CatalogMode, string> = {
  "self-host": "Self-hosted Apps",
  compose: "Docker Compose Maker",
}

function Intro({ mode }: { mode: CatalogMode }) {
  if (mode === "self-host")
    return (
      <>
        Pick Apps, then run one{" "}
        <code className="font-mono">self-host install</code> command. Prefer
        plain YAML? Switch to docker compose.
      </>
    )
  return (
    <>
      Every container DCM knows about. Apps with a self-host badge install with
      one command.
    </>
  )
}

function DockerTools({ catalog, mode }: DockerToolsClientProps) {
  const { selection, entries, visibleIds, hiddenCount } = useCatalogView(
    catalog,
    mode,
  )
  const processedShareRef = useRef(false)
  const selfHostMode = mode === "self-host"

  const counts = useMemo(
    () => ({
      "self-host": entriesForMode(catalog, "self-host").length,
      compose: catalog.entries.length,
    }),
    [catalog],
  )

  useEffect(() => {
    if (processedShareRef.current) return
    const url = new URL(window.location.href)
    const share = url.searchParams.get("share")
    if (!share) return
    processedShareRef.current = true

    const knownIds = new Set(catalog.entries.map((entry) => entry.id))
    const ids = decodeShareUrl(share, knownIds)
    const selfHostIds = new Set(
      entriesForMode(catalog, "self-host").map((entry) => entry.id),
    )
    const needsCompose = ids.some((id) => !selfHostIds.has(id))
    if (selfHostMode && needsCompose) {
      window.location.replace(`${routes.compose}${url.search}${url.hash}`)
      return
    }

    if (ids.length) selection.set(ids)
    url.searchParams.delete("share")
    window.history.replaceState(window.history.state, "", url)
  }, [catalog, selection.set, selfHostMode])

  const toggle = (id: string) => {
    const entry = catalog.entries.find((item) => item.id === id)
    if (entry?.isUnsupported) return
    selection.toggle(id)
  }

  return (
    <>
      <div className="mb-6 flex flex-wrap items-start justify-between gap-4">
        <div>
          <h1 className="font-bold text-3xl">{TITLE[mode]}</h1>
          <p className="mt-1 max-w-2xl text-muted-foreground text-sm">
            <Intro mode={mode} />{" "}
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
        {!selfHostMode && (
          <Button asChild className="flex items-center gap-2">
            <a href={routes.templates}>
              <Palette size={16} />
              Template Gallery
            </a>
          </Button>
        )}
      </div>

      <div className="mb-6">
        <ModeToggle mode={mode} counts={counts} />
      </div>

      {!selfHostMode && (
        <>
          <div className="[animation-delay:300ms] motion-safe:animate-slide-down">
            <SettingsPanel />
          </div>

          <div className="[animation-delay:450ms] motion-safe:animate-slide-down">
            <DiscoveryPanel />
          </div>
        </>
      )}

      <FloatingBar
        catalog={catalog}
        entries={entries}
        mode={mode}
        ids={visibleIds}
        shareIds={selection.ids}
        hiddenCount={hiddenCount}
        onToggle={toggle}
        onClear={selection.clear}
      />

      <ToolGrid
        entries={entries}
        selected={selection.ids}
        onToggle={toggle}
        selfHostBadge={!selfHostMode}
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
