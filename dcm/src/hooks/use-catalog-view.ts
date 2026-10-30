import { useMode } from "@/hooks/use-mode"
import { useSelection } from "@/hooks/use-selection"
import { type Catalog, entriesForMode, partitionSelection } from "@/lib/catalog"
import { useMemo } from "react"

export function useCatalogView(catalog: Catalog) {
  const [mode, setMode] = useMode()
  const selection = useSelection()

  const entries = useMemo(() => entriesForMode(catalog, mode), [catalog, mode])
  const { visibleIds, hiddenCount } = useMemo(
    () => partitionSelection(selection.ids, catalog, entries),
    [catalog, entries, selection.ids],
  )

  return { mode, setMode, selection, entries, visibleIds, hiddenCount }
}
