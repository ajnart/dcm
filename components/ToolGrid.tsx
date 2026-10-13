import type { CatalogEntry } from "@/lib/catalog"
import DockerCard from "./docker-card"

interface ToolGridProps {
  entries: CatalogEntry[]
  selected: string[]
  onToggle: (id: string) => void
}

export default function ToolGrid({
  entries,
  selected,
  onToggle,
}: ToolGridProps) {
  return (
    <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 md:grid-cols-3 lg:grid-cols-4">
      {entries.map((entry) => (
        <DockerCard
          key={entry.id}
          entry={entry}
          isSelected={selected.includes(entry.id)}
          onSelect={() => onToggle(entry.id)}
        />
      ))}
    </div>
  )
}
