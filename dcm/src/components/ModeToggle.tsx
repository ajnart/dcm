import { track } from "@/lib/analytics"
import {
  CATALOG_MODES,
  type CatalogMode,
  MODE_LABELS,
  MODE_PATHS,
  modeHref,
} from "@/lib/modes"
import { cn } from "@/lib/utils"
import type { MouseEvent } from "react"

interface ModeToggleProps {
  mode: CatalogMode
  counts: Record<CatalogMode, number>
}

const plainClick = (event: MouseEvent) =>
  event.button === 0 &&
  !event.metaKey &&
  !event.ctrlKey &&
  !event.shiftKey &&
  !event.altKey

export function ModeToggle({ mode, counts }: ModeToggleProps) {
  const handleClick = (event: MouseEvent, item: CatalogMode) => {
    if (!plainClick(event)) return
    event.preventDefault()
    if (item === mode) return
    track({ name: "dcm_mode_changed", mode: item })
    window.location.assign(modeHref(item, new URL(window.location.href)))
  }

  return (
    <nav aria-label="Catalog" className="inline-flex border border-input">
      {CATALOG_MODES.map((item) => (
        <a
          key={item}
          href={MODE_PATHS[item]}
          aria-current={mode === item ? "page" : undefined}
          onClick={(event) => handleClick(event, item)}
          className={cn(
            "px-3 py-1.5 text-sm transition-colors",
            mode === item
              ? "bg-primary text-primary-foreground"
              : "text-muted-foreground hover:text-foreground",
          )}
        >
          {MODE_LABELS[item]}
          <span className="ml-1.5 opacity-70">{counts[item]}</span>
        </a>
      ))}
    </nav>
  )
}
