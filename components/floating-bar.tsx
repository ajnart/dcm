"use client"

import { IconStack, type StackItem } from "@/components/magicui/avatar-circles"
import { SearchCommand } from "@/components/search-command"
import { Button } from "@/components/ui/button"
import { useClipboard } from "@/hooks/use-clipboard"
import { type Catalog, resolveSelection, toSelfHostIds } from "@/lib/catalog"
import { buildSelfHostCommand, buildSelfHostLink } from "@/lib/selfhost"
import { generateShareUrl } from "@/lib/url-utils"
import { cn } from "@/lib/utils"
import { ExternalLink, RefreshCw, Search, Share2 } from "lucide-react"
import dynamic from "next/dynamic"
import { useMemo, useState } from "react"
import { toast } from "sonner"

const CopyComposeModal = dynamic(
  () =>
    import("@/components/compose-modal/CopyComposeModal").then((mod) => ({
      default: mod.CopyComposeModal,
    })),
  { ssr: false },
)

interface FloatingBarProps {
  catalog: Catalog
  ids: string[]
  onToggle: (id: string) => void
  onClear: () => void
}

export default function FloatingBar({
  catalog,
  ids,
  onToggle,
  onClear,
}: FloatingBarProps) {
  const [isCopyOpen, setIsCopyOpen] = useState(false)
  const [isSharing, setIsSharing] = useState(false)
  const [isResetActive, setIsResetActive] = useState(false)
  const { copy } = useClipboard()

  const resolved = useMemo(() => resolveSelection(ids, catalog), [ids, catalog])
  const selfHostIds = useMemo(() => toSelfHostIds(ids, catalog), [ids, catalog])

  const stack: StackItem[] = [
    ...resolved.recipes.map((recipe) => ({
      id: recipe.id,
      name: recipe.name,
    })),
    ...resolved.entries,
  ]
  const count = stack.length
  const command =
    selfHostIds.length > 0 ? buildSelfHostCommand(selfHostIds) : ""

  const handleResetClick = () => {
    if (!isResetActive) {
      setIsResetActive(true)
      return
    }
    onClear()
    setIsResetActive(false)
  }

  const handleShare = async () => {
    if (count === 0) return
    setIsSharing(true)
    const success = await copy(generateShareUrl(ids))
    if (success) {
      toast.success("Share URL copied to clipboard!", {
        description: "Share this link to show your selected services",
      })
    } else {
      toast.error("Failed to copy URL", {
        description: "Please ensure you're using HTTPS or try again",
      })
    }
    setTimeout(() => setIsSharing(false), 1000)
  }

  const openSearch = () =>
    document.dispatchEvent(new CustomEvent("triggerCommandK"))

  return (
    <>
      <SearchCommand catalog={catalog} selected={ids} onToggle={onToggle} />

      <CopyComposeModal
        isOpen={isCopyOpen}
        onOpenChange={setIsCopyOpen}
        selectedTools={resolved.yamlTools}
        yamlMissing={resolved.yamlMissing}
        selfHostIds={selfHostIds}
      />

      <div className="sticky top-[58px] z-30 mb-8 border border-line bg-panel p-3 shadow-md">
        <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
          <div className="min-w-0">
            <p className="text-muted-foreground text-xs">{count} selected</p>
            <div className="mt-1 h-9">
              {count > 0 && <IconStack items={stack} onToggle={onToggle} />}
            </div>
          </div>

          <div className="flex flex-wrap gap-2">
            <Button variant="outline" onClick={openSearch}>
              <Search className="h-3.5 w-3.5" />
              Search
              <kbd className="hidden text-[10px] sm:inline">⌘K</kbd>
            </Button>
            <Button
              variant="outline"
              disabled={count === 0}
              onClick={handleShare}
              className={cn(isSharing && "motion-preset-confetti")}
            >
              <Share2 className="h-3.5 w-3.5" />
              Share
            </Button>
            <Button
              variant={isResetActive ? "destructive" : "outline"}
              disabled={count === 0}
              onClick={handleResetClick}
              onMouseLeave={() => setIsResetActive(false)}
              className="min-w-28"
            >
              <RefreshCw
                className={cn("h-3.5 w-3.5", isResetActive && "animate-spin")}
              />
              {isResetActive ? "U sure?" : "Unselect"}
            </Button>
            <Button
              disabled={resolved.yamlTools.length === 0}
              onClick={() => setIsCopyOpen(true)}
            >
              Copy Compose
            </Button>
          </div>
        </div>

        {command && (
          <div className="mt-3 flex flex-wrap items-center justify-between gap-2 border-line border-t pt-3 text-xs">
            <button
              type="button"
              onClick={() =>
                copy(command).then(() => toast.success("Command copied"))
              }
              aria-label="Copy self-host command"
              className="min-w-0 max-w-full truncate text-left text-cyan hover:text-pink"
            >
              <span className="text-pink">$</span> {command}
            </button>
            <a
              href={buildSelfHostLink(selfHostIds)}
              target="_blank"
              rel="noopener noreferrer"
              className="inline-flex items-center gap-1 text-muted-foreground hover:text-pink"
            >
              Rather not manage YAML? self-host installs and wires these for you
              <ExternalLink className="h-3 w-3" />
            </a>
          </div>
        )}
      </div>
    </>
  )
}
