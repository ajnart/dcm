import { AppCard } from "@/components/app-card"
import {
  HoverCard,
  HoverCardContent,
  HoverCardTrigger,
} from "@/components/ui/hover-card"
import type { CatalogEntry } from "@/lib/catalog"
import { routes } from "@/lib/routes"
import type { ReactNode } from "react"

interface ToolGridProps {
  entries: CatalogEntry[]
  selected: string[]
  onToggle: (id: string) => void
  selfHostBadge?: boolean
}

function badgeFor(
  entry: CatalogEntry,
  selfHostBadge: boolean,
): string | undefined {
  if (entry.installOnly) return "Install with self-host"
  if (selfHostBadge && entry.selfhostId) return "self-host"
  return undefined
}

function Note({
  entry,
  children,
}: { entry: CatalogEntry; children: ReactNode }) {
  if (entry.isUnsupported) {
    return (
      <HoverCard openDelay={100} closeDelay={100}>
        <HoverCardTrigger asChild>
          <div className="appcard-slot">{children}</div>
        </HoverCardTrigger>
        <HoverCardContent className="w-80 border-destructive shadow-md">
          <div className="flex flex-col gap-2">
            <p className="font-semibold">Unsupported Container</p>
            <p className="text-muted-foreground text-xs">
              This container is not officially supported in our tool. <br />
              We recommend following the official documentation for installation
              instructions.
            </p>
            <a
              href={entry.githubUrl || "#"}
              target="_blank"
              rel="noopener noreferrer"
              className="text-accent-text text-sm hover:underline"
            >
              View Official Documentation
            </a>
          </div>
        </HoverCardContent>
      </HoverCard>
    )
  }

  if (entry.installOnly) {
    return (
      <HoverCard openDelay={100} closeDelay={100}>
        <HoverCardTrigger asChild>
          <div className="appcard-slot">{children}</div>
        </HoverCardTrigger>
        <HoverCardContent className="w-80 shadow-md">
          <div className="flex flex-col gap-2">
            <p className="font-semibold">Install with self-host</p>
            <p className="text-muted-foreground text-xs">
              {entry.notes ??
                "This App has no standalone Compose file. self-host installs it for you."}
            </p>
            <code className="border bg-muted px-2 py-1 font-mono text-xs">
              self-host install {entry.selfhostId}
            </code>
          </div>
        </HoverCardContent>
      </HoverCard>
    )
  }

  return <div className="appcard-slot">{children}</div>
}

export default function ToolGrid({
  entries,
  selected,
  onToggle,
  selfHostBadge = false,
}: ToolGridProps) {
  return (
    <div className="appcard-grid">
      {entries.map((entry) => (
        <Note key={entry.id} entry={entry}>
          <AppCard
            name={entry.name}
            description={entry.description}
            icon={entry.icon}
            stars={entry.stars}
            repoUrl={entry.githubUrl}
            detailsHref={
              entry.selfhostId ? routes.app(entry.selfhostId) : undefined
            }
            wires={entry.wires}
            badge={badgeFor(entry, selfHostBadge)}
            selected={selected.includes(entry.id)}
            unsupported={entry.isUnsupported}
            onSelect={() => onToggle(entry.id)}
          />
        </Note>
      ))}
    </div>
  )
}
