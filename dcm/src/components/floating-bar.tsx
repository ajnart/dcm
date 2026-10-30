import { CopyLabel } from "@/components/copy-label"
import { ServiceCircles } from "@/components/magicui/avatar-circles"
import { SearchCommand } from "@/components/search-command"
import { SelfHostCommand } from "@/components/selfhost-command"
import { Button } from "@/components/ui/button"
import { useClipboard } from "@/hooks/use-clipboard"
import { track } from "@/lib/analytics"
import type { Catalog, CatalogEntry } from "@/lib/catalog"
import { buildExport } from "@/lib/export"
import type { CatalogMode } from "@/lib/modes"
import { routes } from "@/lib/routes"
import { buildSelfHostLink } from "@/lib/selfhost"
import { useSettings } from "@/lib/settings-context"
import { generateShareUrl } from "@/lib/url-utils"
import { cn } from "@/lib/utils"
import { ExternalLink, RefreshCw, Search, Share2 } from "lucide-react"
import { Suspense, lazy, useEffect, useMemo, useState } from "react"

const CopyComposeModal = lazy(() =>
  import("@/components/compose-modal/CopyComposeModal").then((mod) => ({
    default: mod.CopyComposeModal,
  })),
)

interface FloatingBarProps {
  catalog: Catalog
  entries: CatalogEntry[]
  mode: CatalogMode
  ids: string[]
  shareIds: string[]
  hiddenCount: number
  onToggle: (id: string) => void
  onClear: () => void
  scrollPosition?: number
}

export default function FloatingBar({
  catalog,
  entries,
  mode,
  ids,
  shareIds,
  hiddenCount,
  onToggle,
  onClear,
  scrollPosition = 200,
}: FloatingBarProps) {
  const [isCopyDialogOpen, setIsCopyDialogOpen] = useState(false)
  const [isFixed, setIsFixed] = useState(false)
  const [isApple, setIsApple] = useState(false)
  const [isMounted, setIsMounted] = useState(false)
  const [isResetActive, setIsResetActive] = useState(false)
  const { copy, copied } = useClipboard()

  const { settings } = useSettings()
  const exported = useMemo(
    () => buildExport(ids, catalog, settings),
    [ids, catalog, settings],
  )
  const selectedCount = exported.entries.length
  const selfHostMode = mode === "self-host"

  useEffect(() => {
    setIsMounted(true)
  }, [])

  useEffect(() => {
    if (typeof window !== "undefined") {
      setIsApple(/Mac|iPod|iPhone|iPad/.test(navigator.userAgent))
    }
  }, [])

  useEffect(() => {
    if (typeof window === "undefined") return

    const handleScroll = () => {
      setIsFixed(window.scrollY > scrollPosition)
    }

    window.addEventListener("scroll", handleScroll)
    return () => window.removeEventListener("scroll", handleScroll)
  }, [scrollPosition])

  const handleResetClick = () => {
    if (!isResetActive) {
      setIsResetActive(true)
      return
    }

    onClear()
    setIsResetActive(false)
  }

  const handleResetMouseLeave = () => {
    if (isResetActive) {
      setIsResetActive(false)
    }
  }

  const handleShare = async (event: React.MouseEvent<HTMLButtonElement>) => {
    if (shareIds.length === 0) return

    const ok = await copy(generateShareUrl(shareIds), event.currentTarget)
    if (ok) track({ name: "dcm_share_copied", count: shareIds.length })
  }

  const handleCopyCompose = () => {
    setIsCopyDialogOpen(true)
  }

  // Prevent rendering client-interactive elements during SSR
  const triggerSearchShortcut = (e: React.MouseEvent) => {
    if (!isMounted) return

    e.preventDefault()

    // Use a custom event that the SearchCommand component will listen for
    // Instead of trying to simulate a keyboard event
    const customEvent = new CustomEvent("triggerCommandK", {
      bubbles: true,
    })
    document.dispatchEvent(customEvent)
  }

  const commandRow = (
    <div
      className={cn(
        "flex flex-col gap-2 text-muted-foreground text-sm sm:flex-row sm:items-center sm:justify-between",
        selfHostMode ? "mb-4 border-b pb-4" : "mt-4 border-t pt-3",
      )}
    >
      <SelfHostCommand
        command={exported.selfHostCommand}
        ids={exported.selfHostIds}
        prominent={selfHostMode}
      />
      <a
        href={buildSelfHostLink(exported.selfHostIds)}
        target="_blank"
        rel="noopener noreferrer"
        className="inline-flex items-center gap-1 transition-colors hover:text-accent-text hover:underline"
      >
        {selfHostMode
          ? "Open this selection on self-host.fyi"
          : "Rather not manage YAML? Let self-host do it"}
        <ExternalLink className="h-3 w-3" />
      </a>
    </div>
  )

  return (
    <>
      <SearchCommand entries={entries} selected={ids} onToggle={onToggle} />

      {isMounted && (
        <Suspense fallback={null}>
          <CopyComposeModal
            isOpen={isCopyDialogOpen}
            onOpenChange={setIsCopyDialogOpen}
            exported={exported}
          />
        </Suspense>
      )}

      <div
        className={cn(
          "z-30 w-full transition-all duration-300",
          isFixed
            ? "fixed top-(--site-header-height) right-0 left-0 bg-background/60 py-4 shadow-lg backdrop-blur-md"
            : "relative mb-8 [animation-delay:450ms] motion-safe:animate-slide-down",
        )}
      >
        <div
          className={cn(
            "container mx-auto w-full px-0",
            isFixed && "max-w-7xl px-4",
            isFixed
              ? ""
              : "rounded-lg border border-border bg-background/40 p-4 shadow-lg backdrop-blur-md motion-safe:animate-slide-up",
          )}
        >
          {selfHostMode && commandRow}
          <div className="flex flex-col items-start justify-between gap-4 sm:flex-row sm:items-center">
            <div className="items-center gap-2">
              <span className="font-xs text-muted-foreground">
                {selectedCount} service{selectedCount !== 1 ? "s" : ""} selected
              </span>
              {hiddenCount > 0 && (
                <span className="ml-2 text-muted-foreground text-xs">
                  {hiddenCount} selected item{hiddenCount !== 1 ? "s" : ""}{" "}
                  hidden in self-host mode.{" "}
                  <a
                    href={routes.compose}
                    className="font-medium text-accent-text hover:underline"
                  >
                    Switch to docker compose
                  </a>
                </span>
              )}
              <div className="sm:w-auto">
                {selectedCount > 0 && (
                  <div className="flex max-w-full flex-wrap gap-1.5 sm:max-w-[600px]">
                    <ServiceCircles
                      selectedServices={exported.entries}
                      spacing="-space-x-1 xs:-space-x-2 sm:-space-x-4"
                      onToggleServiceSelection={onToggle}
                      className="mt-1"
                    />
                  </div>
                )}
              </div>
            </div>

            <div className="mt-2 flex w-full flex-wrap gap-2 sm:mt-0 sm:w-auto">
              <div className="flex gap-2">
                <Button
                  variant="outline"
                  className="flex items-center gap-2 transition-transform motion-safe:hover:scale-105"
                  onClick={triggerSearchShortcut}
                >
                  <Search className="h-3.5 w-3.5" />
                  <span className="xs:inline hidden">Search</span>
                  <kbd className="pointer-events-none ml-1 hidden h-5 select-none items-center gap-1 rounded border bg-muted px-1.5 font-medium font-mono text-[10px] text-muted-foreground opacity-100 sm:inline-flex">
                    <span className="text-xs">
                      {isMounted ? (isApple ? "⌘" : "Ctrl") : "⌘"}
                    </span>
                    K
                  </kbd>
                </Button>

                <Button
                  variant="outline"
                  disabled={shareIds.length === 0}
                  className="flex xs:min-w-16 items-center gap-2 transition-transform motion-safe:hover:scale-105"
                  onClick={handleShare}
                >
                  <CopyLabel
                    copied={copied}
                    icon={<Share2 className="h-3.5 w-3.5" />}
                    label="Share"
                    labelClassName="xs:inline hidden"
                  />
                </Button>

                <Button
                  variant={isResetActive ? "destructive" : "outline"}
                  disabled={shareIds.length === 0}
                  onClick={handleResetClick}
                  onMouseLeave={handleResetMouseLeave}
                  className="group relative flex items-center gap-2 transition-all motion-safe:hover:scale-105"
                >
                  <RefreshCw
                    className={cn(
                      "h-3.5 w-3.5",
                      isResetActive && "animate-spin",
                    )}
                  />
                  {!isResetActive ? (
                    <span className="xs:inline hidden xs:min-w-16">
                      Unselect
                    </span>
                  ) : (
                    <span className="xs:min-w-16 text-destructive-foreground motion-safe:animate-shake">
                      <span className="xs:inline hidden">U sure?</span>
                    </span>
                  )}
                </Button>
              </div>
              <Button
                variant={selfHostMode ? "outline" : "default"}
                disabled={exported.composable.length === 0}
                className="xs:w-auto font-semibold"
                onClick={handleCopyCompose}
              >
                Copy Compose
              </Button>
            </div>
          </div>

          {!selfHostMode && exported.selfHostIds.length > 0 && commandRow}
        </div>
      </div>
    </>
  )
}
