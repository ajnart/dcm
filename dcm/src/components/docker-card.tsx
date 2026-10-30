import { Badge } from "@/components/ui/badge"
import { Card, CardContent } from "@/components/ui/card"
import { GitHubLink } from "@/components/ui/github-link"
import {
  HoverCard,
  HoverCardContent,
  HoverCardTrigger,
} from "@/components/ui/hover-card"
import { StarCount } from "@/components/ui/star-count"
import { TruncatedText } from "@/components/ui/truncated-text"
import type { CatalogEntry } from "@/lib/catalog"
import { routes } from "@/lib/routes"
import { cn } from "@/lib/utils"

function portLabel(entry: CatalogEntry): string {
  if (entry.port) return `:${entry.port}`
  return "no ui"
}

interface DockerCardProps {
  entry: CatalogEntry
  isSelected: boolean
  onSelect: () => void
  selfHostBadge?: boolean
}

export default function DockerCard({
  entry,
  isSelected,
  onSelect,
  selfHostBadge = false,
}: DockerCardProps) {
  const handleCardClick = (e: React.MouseEvent) => {
    if (
      (e.target as Element).closest(".github-link") ||
      (e.target as Element).closest(".description-expand") ||
      (e.target as Element).closest(".app-link") ||
      entry.isUnsupported
    ) {
      e.stopPropagation()
      return
    }
    onSelect()
  }

  const CardComponent = (
    <Card
      className={cn(
        "group relative h-full cursor-pointer select-none overflow-hidden rounded-sm transition-all hover:shadow-md",
        isSelected && !entry.isUnsupported
          ? "bg-secondary"
          : entry.isUnsupported
            ? "hover:border-destructive/50"
            : "hover:border-muted-foreground/20",
        "motion-safe:hover:scale-105",
      )}
      onClick={handleCardClick}
    >
      <div
        className={cn(
          "h-1 w-full transition-colors duration-300",
          isSelected && !entry.isUnsupported
            ? "bg-primary"
            : entry.isUnsupported
              ? "bg-transparent group-hover:bg-destructive/50"
              : "bg-transparent group-hover:bg-primary/30",
        )}
      />

      {entry.githubUrl && (
        <div className="absolute top-2 right-2 z-10 flex items-center gap-2">
          {entry.stars !== undefined && <StarCount count={entry.stars} />}
          <GitHubLink url={entry.githubUrl} />
        </div>
      )}

      <CardContent className="flex h-full flex-col p-4">
        <div className="mb-3 grid grid-cols-[auto_1fr] items-center gap-2">
          <div
            className={cn(
              "flex h-10 w-10 items-center justify-center overflow-hidden rounded-md transition-all duration-300",
              isSelected && !entry.isUnsupported
                ? "bg-primary/40 text-primary-foreground"
                : "bg-primary/10 text-accent-text group-hover:bg-primary/20",
            )}
          >
            {entry.icon ? (
              <img
                src={entry.icon}
                alt={entry.name}
                className="h-full min-h-4 w-full min-w-4 p-1.5"
              />
            ) : (
              <div className="font-bold">{entry.name.charAt(0)}</div>
            )}
          </div>
          <div className="flex w-full items-center justify-between gap-2">
            <h3 className="font-mono font-semibold tracking-tight">
              {entry.name}
            </h3>
            <p className="text-muted-foreground text-xs">{entry.category}</p>
          </div>
        </div>
        <div className="mb-3">
          <TruncatedText text={entry.description} />
        </div>
        <div className="mt-auto flex flex-wrap gap-1">
          {entry.installOnly && (
            <Badge
              variant="default"
              className="rounded-md px-1 font-normal text-xs"
            >
              Install with self-host
            </Badge>
          )}
          {selfHostBadge && entry.selfhostId && !entry.installOnly && (
            <Badge
              variant="default"
              className="rounded-md px-1 font-normal text-xs"
            >
              self-host
            </Badge>
          )}
          {entry.tags.map((tag) => (
            <Badge
              key={tag}
              variant="outline"
              className="rounded-md px-1 font-normal text-xs transition-all duration-300"
            >
              {tag}
            </Badge>
          ))}
        </div>
        {entry.selfhostId && (
          <div className="mt-3 flex items-center justify-between text-muted-foreground text-xs">
            <span className="font-mono">{portLabel(entry)}</span>
            <a
              href={routes.app(entry.selfhostId)}
              className="app-link font-medium text-accent-text hover:underline"
            >
              details →
            </a>
          </div>
        )}
      </CardContent>
    </Card>
  )

  if (entry.isUnsupported) {
    return (
      <HoverCard openDelay={100} closeDelay={100}>
        <HoverCardTrigger asChild>{CardComponent}</HoverCardTrigger>
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
        <HoverCardTrigger asChild>{CardComponent}</HoverCardTrigger>
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

  return CardComponent
}
