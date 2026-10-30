import toolStars from "@/data/stars.json"
import type { Catalog, CatalogEntry } from "@/lib/catalog"
import appStars from "../../../site/src/data/stars.json"

interface StarEntry {
  stars: number
}

const appCounts: Record<string, StarEntry | undefined> = appStars
const toolCounts: Record<string, StarEntry | undefined> = toolStars

function withEntryStars(entry: CatalogEntry): CatalogEntry {
  const app = entry.selfhostId ? appCounts[entry.selfhostId] : undefined
  const found = app ?? toolCounts[entry.id]
  if (!found) return entry
  return { ...entry, stars: found.stars }
}

export function withStars(catalog: Catalog): Catalog {
  return { ...catalog, entries: catalog.entries.map(withEntryStars) }
}
