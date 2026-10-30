import type { CatalogEntry } from "@/lib/catalog"
import DockerCard from "./docker-card"

interface ToolGridProps {
  entries: CatalogEntry[]
  selected: string[]
  onToggle: (id: string) => void
  selfHostBadge?: boolean
}

const GRID =
  "grid 3xl:grid-cols-7 grid-cols-1 gap-3 sm:grid-cols-2 md:grid-cols-3 lg:grid-cols-4 xl:grid-cols-5"

export default function ToolGrid({
  entries,
  selected,
  onToggle,
  selfHostBadge = false,
}: ToolGridProps) {
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
      <div className={GRID}>{entries.map(renderCard)}</div>
    </div>
  )
}
