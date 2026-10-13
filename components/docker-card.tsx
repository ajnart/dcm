"use client"

import { GitHubLink } from "@/components/ui/github-link"
import {
  HoverCard,
  HoverCardContent,
  HoverCardTrigger,
} from "@/components/ui/hover-card"
import { StarCount } from "@/components/ui/star-count"
import { TruncatedText } from "@/components/ui/truncated-text"
import type { CatalogEntry } from "@/lib/catalog"
import { cn } from "@/lib/utils"
import Link from "next/link"

interface DockerCardProps {
  entry: CatalogEntry
  isSelected: boolean
  onSelect: () => void
}

const chip = "border px-1 text-[11px] leading-5"

export default function DockerCard({
  entry,
  isSelected,
  onSelect,
}: DockerCardProps) {
  const handleClick = (e: React.MouseEvent) => {
    if ((e.target as Element).closest(".description-expand")) return
    if (entry.isUnsupported) return
    onSelect()
  }

  const card = (
    <div className="group relative h-full">
      <button
        type="button"
        aria-pressed={isSelected && !entry.isUnsupported}
        onClick={handleClick}
        className={cn(
          "card-top hover:-translate-x-0.5 hover:-translate-y-0.5 flex h-full w-full cursor-pointer select-none flex-col border border-line bg-panel p-4 pt-5 text-left shadow-sm transition-all hover:shadow-md",
          isSelected && !entry.isUnsupported && "border-violet bg-secondary",
          entry.isUnsupported && "opacity-70 hover:border-red/60",
        )}
      >
        <div className="mb-3 flex items-center gap-3">
          <div className="flex h-10 w-10 shrink-0 items-center justify-center overflow-hidden border border-line bg-deep font-bold text-pink">
            {entry.icon ? (
              <img
                src={entry.icon}
                alt=""
                className="h-full w-full object-contain p-1.5"
              />
            ) : (
              entry.name.charAt(0)
            )}
          </div>
          <div className="min-w-0">
            <h3 className="truncate font-bold text-ink">{entry.name}</h3>
            <p className="text-muted-foreground text-xs">{entry.category}</p>
          </div>
        </div>

        <div className="mb-3 text-muted-foreground">
          <TruncatedText text={entry.description} />
        </div>

        <div className="mt-auto flex flex-wrap gap-1">
          {entry.selfhostOnly && (
            <span className={cn(chip, "border-pink/60 text-pink")}>
              self-host only
            </span>
          )}
          {entry.selfhostId && !entry.selfhostOnly && (
            <span className={cn(chip, "border-green/50 text-green")}>
              self-host
            </span>
          )}
          {entry.port !== undefined && (
            <span className={cn(chip, "border-line text-cyan")}>
              :{entry.port}
            </span>
          )}
          {entry.tags.map((tag) => (
            <span key={tag} className={cn(chip, "border-line text-dim")}>
              {tag}
            </span>
          ))}
        </div>
      </button>
      {entry.githubUrl && (
        <div className="absolute top-3 right-2 z-10 flex items-center gap-2">
          {entry.stars !== undefined && <StarCount count={entry.stars} />}
          <GitHubLink url={entry.githubUrl} />
        </div>
      )}
    </div>
  )

  if (!entry.isUnsupported) return card

  return (
    <HoverCard openDelay={100} closeDelay={100}>
      <HoverCardTrigger asChild>{card}</HoverCardTrigger>
      <HoverCardContent className="w-80 border-red">
        <div className="flex flex-col gap-2">
          <p className="font-semibold">Unsupported Container</p>
          <p className="text-muted-foreground text-xs">
            This container is not officially supported in our tool. <br />
            We recommend following the official documentation for installation
            instructions.
          </p>
          <Link
            href={entry.githubUrl || "#"}
            target="_blank"
            className="text-pink text-sm hover:underline"
          >
            View Official Documentation
          </Link>
        </div>
      </HoverCardContent>
    </HoverCard>
  )
}
