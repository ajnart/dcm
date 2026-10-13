"use client"

import { ServiceCircles } from "@/components/magicui/avatar-circles"
import { SearchCommand } from "@/components/search-command"
import { Button } from "@/components/ui/button"
import { useClipboard } from "@/hooks/use-clipboard"
import { type Catalog, resolveSelection, toSelfHostIds } from "@/lib/catalog"
import { buildSelfHostCommand, buildSelfHostLink } from "@/lib/selfhost"
import { generateShareUrl } from "@/lib/url-utils"
import { cn } from "@/lib/utils"
import { ExternalLink, RefreshCw, Search, Share2 } from "lucide-react"
import dynamic from "next/dynamic"
import { useEffect, useMemo, useState } from "react"
import { toast } from "sonner"

// Dynamically import CopyComposeModal with loading state
const CopyComposeModal = dynamic(
  () =>
    import("@/components/compose-modal/CopyComposeModal").then((mod) => ({
      default: mod.CopyComposeModal,
    })),
  {
    ssr: false, // Disable SSR for the Monaco editor to prevent hydration issues
  },
)

interface FloatingBarProps {
  catalog: Catalog
  ids: string[]
  onToggle: (id: string) => void
  onClear: () => void
  scrollPosition?: number
}

export default function FloatingBar({
  catalog,
  ids,
  onToggle,
  onClear,
  scrollPosition = 200,
}: FloatingBarProps) {
  const [isCopyDialogOpen, setIsCopyDialogOpen] = useState(false)
  const [isFixed, setIsFixed] = useState(false)
  const [isApple, setIsApple] = useState(false)
  const [isMounted, setIsMounted] = useState(false)
  const [isSharing, setIsSharing] = useState(false)
  const [isResetActive, setIsResetActive] = useState(false)
  const { copy } = useClipboard()

  const resolved = useMemo(() => resolveSelection(ids, catalog), [ids, catalog])
  const selfHostIds = useMemo(() => toSelfHostIds(ids, catalog), [ids, catalog])
  const selectedCount = resolved.entries.length
  const command = buildSelfHostCommand(selfHostIds)

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

  const handleShare = async () => {
    if (selectedCount === 0) return

    // Generate encoded share URL
    const shareUrl = generateShareUrl(ids)

    // Show animation state
    setIsSharing(true)

    // Use React hook for clipboard operations
    const success = await copy(shareUrl)

    if (success) {
      toast.success("Share URL copied to clipboard!", {
        description: "Share this link to show your selected services",
      })
    } else {
      toast.error("Failed to copy URL", {
        description: "Please ensure you're using HTTPS or try again",
      })
    }

    // Reset animation state
    setTimeout(() => setIsSharing(false), 1000)
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

  return (
    <>
      <SearchCommand catalog={catalog} selected={ids} onToggle={onToggle} />

      {isMounted && (
        <CopyComposeModal
          isOpen={isCopyDialogOpen}
          onOpenChange={setIsCopyDialogOpen}
          selectedTools={resolved.yamlTools}
          yamlMissing={resolved.yamlMissing}
          selfHostIds={selfHostIds}
        />
      )}

      <div
        className={cn(
          "z-30 w-full transition-all duration-300",
          isFixed
            ? "fixed top-0 right-0 left-0 bg-background/60 py-4 shadow-lg backdrop-blur-md"
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
          <div className="flex flex-col items-start justify-between gap-4 sm:flex-row sm:items-center">
            <div className="items-center gap-2">
              <span className="font-xs text-muted-foreground">
                {selectedCount} service{selectedCount !== 1 ? "s" : ""} selected
              </span>
              <div className="sm:w-auto">
                {selectedCount > 0 && (
                  <div className="flex max-w-full flex-wrap gap-1.5 sm:max-w-[600px]">
                    <ServiceCircles
                      selectedServices={resolved.entries}
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
                  disabled={selectedCount === 0}
                  className={cn(
                    "flex xs:min-w-16 items-center gap-2 transition-transform",
                    isSharing
                      ? "motion-preset-confetti "
                      : "motion-safe:hover:scale-105",
                  )}
                  onClick={handleShare}
                >
                  <Share2 className="h-3.5 w-3.5" />
                  <span className="xs:inline hidden">Share</span>
                </Button>

                <Button
                  variant={isResetActive ? "destructive" : "outline"}
                  disabled={selectedCount === 0}
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
                    <span className="motion-preset-shake xs:min-w-16 text-destructive-foreground">
                      <span className="xs:inline hidden">U sure?</span>
                    </span>
                  )}
                </Button>
              </div>
              <Button
                disabled={resolved.yamlTools.length === 0}
                className="hover:motion-preset-confetti xs:w-auto font-semibold"
                onClick={() => setIsCopyDialogOpen(true)}
              >
                Copy Compose
              </Button>
            </div>
          </div>

          {selfHostIds.length > 0 && (
            <div className="mt-4 flex flex-col gap-2 border-t pt-3 text-muted-foreground text-sm sm:flex-row sm:items-center sm:justify-between">
              <button
                type="button"
                onClick={() =>
                  copy(command).then((ok) =>
                    ok
                      ? toast.success("Command copied")
                      : toast.error("Failed to copy command"),
                  )
                }
                aria-label="Copy self-host command"
                className="min-w-0 max-w-full truncate rounded-md border bg-muted px-2 py-1 text-left font-mono text-foreground text-xs transition-colors hover:bg-accent"
              >
                {command}
              </button>
              <a
                href={buildSelfHostLink(selfHostIds)}
                target="_blank"
                rel="noopener noreferrer"
                className="inline-flex items-center gap-1 transition-colors hover:text-primary hover:underline"
              >
                Rather not manage YAML? Try the self-host preview
                <ExternalLink className="h-3 w-3" />
              </a>
            </div>
          )}
        </div>
      </div>
    </>
  )
}
