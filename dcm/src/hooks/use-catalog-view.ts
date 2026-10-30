import { useSelection } from "@/hooks/use-selection"
import { type Catalog, entriesForMode, partitionSelection } from "@/lib/catalog"
import type { CatalogMode } from "@/lib/modes"
import { track } from "@/lib/track"
import { useMemo } from "react"

export function useCatalogView(catalog: Catalog, mode: CatalogMode) {
  const selection = useSelection()

  const entries = useMemo(() => entriesForMode(catalog, mode), [catalog, mode])
  const { visibleIds, hiddenCount } = useMemo(
    () => partitionSelection(selection.ids, catalog, entries),
    [catalog, entries, selection.ids],
  )

  const toggle = (id: string) => {
    const selecting = !selection.ids.includes(id)
    selection.toggle(id)
    const entry = catalog.entries.find((item) => item.id === id)
    if (!entry) return
    track({
      name: selecting ? "dcm_item_selected" : "dcm_item_unselected",
      id,
      source: entry.selfhostId ? "self-host" : "dcm",
    })
  }

  return {
    selection: { ...selection, toggle },
    entries,
    visibleIds,
    hiddenCount,
  }
}
