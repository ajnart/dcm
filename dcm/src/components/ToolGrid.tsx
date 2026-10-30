import type { CatalogEntry } from "@/lib/catalog"
import { useMemo } from "react"
import DockerCard from "./docker-card"

interface ToolGridProps {
  entries: CatalogEntry[]
  selected: string[]
  onToggle: (id: string) => void
  selfHostBadge?: boolean
  grouped?: boolean
}

interface CategoryGroup {
  category: string
  entries: CatalogEntry[]
}

const byPopularity = (a: CatalogEntry, b: CatalogEntry) =>
  (b.stars ?? 0) - (a.stars ?? 0) || a.name.localeCompare(b.name)

function groupByCategory(entries: CatalogEntry[]): CategoryGroup[] {
  const groups = new Map<string, CatalogEntry[]>()
  for (const entry of entries) {
    const category = entry.category ?? "Other"
    groups.set(category, [...(groups.get(category) ?? []), entry])
  }
  return [...groups.keys()].sort().map((category) => ({
    category,
    entries: (groups.get(category) ?? []).sort(byPopularity),
  }))
}

const GRID =
  "grid 3xl:grid-cols-7 grid-cols-1 gap-3 sm:grid-cols-2 md:grid-cols-3 lg:grid-cols-4 xl:grid-cols-5"

export default function ToolGrid({
  entries,
  selected,
  onToggle,
  selfHostBadge = false,
  grouped = false,
}: ToolGridProps) {
  const groups = useMemo(
    () => (grouped ? groupByCategory(entries) : []),
    [entries, grouped],
  )

  const renderCard = (entry: CatalogEntry) => (
    <div key={entry.id} className="h-full">
      <DockerCard
        entry={entry}
        isSelected={selected.includes(entry.id)}
        onSelect={() => onToggle(entry.id)}
        selfHostBadge={selfHostBadge}
      />
    </div>
  )

  return (
    <div className="before:-inset-4 before:-z-10 relative rounded-lg p-4 before:absolute before:rounded-lg before:bg-linear-to-r before:from-primary/20 before:via-primary/5 before:to-primary/20 before:blur-3xl">
      {grouped ? (
        <div className="flex flex-col gap-8">
          {groups.map((group) => (
            <section key={group.category} aria-label={group.category}>
              <h2 className="mb-3 font-semibold text-lg">
                {group.category}
                <span className="ml-2 font-normal text-muted-foreground text-sm">
                  {group.entries.length}
                </span>
              </h2>
              <div className={GRID}>{group.entries.map(renderCard)}</div>
            </section>
          ))}
        </div>
      ) : (
        <div className={GRID}>{entries.map(renderCard)}</div>
      )}
    </div>
  )
}
