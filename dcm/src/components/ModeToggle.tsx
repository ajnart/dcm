import { CATALOG_MODES, type CatalogMode } from "@/lib/catalog"
import { cn } from "@/lib/utils"

const LABELS: Record<CatalogMode, string> = {
  "self-host": "self-host",
  all: "All",
}

interface ModeToggleProps {
  mode: CatalogMode
  counts: Record<CatalogMode, number>
  onChange: (mode: CatalogMode) => void
}

export function ModeToggle({ mode, counts, onChange }: ModeToggleProps) {
  return (
    <fieldset className="m-0 inline-flex border border-input p-0">
      <legend className="sr-only">Catalog</legend>
      {CATALOG_MODES.map((item) => (
        <button
          key={item}
          type="button"
          aria-pressed={mode === item}
          onClick={() => onChange(item)}
          className={cn(
            "px-3 py-1.5 text-sm transition-colors",
            mode === item
              ? "bg-primary text-primary-foreground"
              : "text-muted-foreground hover:text-foreground",
          )}
        >
          {LABELS[item]}
          <span className="ml-1.5 opacity-70">{counts[item]}</span>
        </button>
      ))}
    </fieldset>
  )
}
