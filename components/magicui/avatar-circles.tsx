"use client"

import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover"
import { cn } from "@/lib/utils"

export interface StackItem {
  id: string
  name: string
  icon?: string
}

interface IconStackProps {
  className?: string
  items: StackItem[]
  onToggle?: (id: string) => void
  max?: number
}

function Tile({ item, size }: { item: StackItem; size: string }) {
  return (
    <span
      className={cn(
        "flex shrink-0 items-center justify-center overflow-hidden border border-line bg-deep font-bold text-pink",
        size,
      )}
    >
      {item.icon ? (
        <img
          className="h-full w-full object-contain p-1"
          src={item.icon}
          alt=""
        />
      ) : (
        item.name.charAt(0)
      )}
    </span>
  )
}

export const IconStack = ({
  className,
  items,
  onToggle,
  max = 9,
}: IconStackProps) => {
  const shown = items.slice(0, max)
  const rest = items.slice(max)

  return (
    <div className={cn("flex items-center", className)}>
      {shown.map((item) => (
        <button
          key={item.id}
          type="button"
          title={`${item.name} (click to remove)`}
          aria-label={`Remove ${item.name}`}
          onClick={() => onToggle?.(item.id)}
          className="-ml-1.5 hover:-translate-y-0.5 relative transition-transform first:ml-0 hover:z-10 [&>span]:hover:border-pink"
        >
          <Tile item={item} size="h-9 w-9" />
        </button>
      ))}
      {rest.length > 0 && (
        <Popover>
          <PopoverTrigger asChild>
            <button
              type="button"
              className="-ml-1.5 relative flex h-9 w-9 items-center justify-center border border-line bg-purple text-ink text-xs hover:z-10 hover:border-pink"
            >
              +{rest.length}
            </button>
          </PopoverTrigger>
          <PopoverContent
            className="max-h-60 w-52 overflow-y-auto p-2"
            align="center"
            side="bottom"
          >
            <ul className="space-y-1">
              {rest.map((item) => (
                <li key={item.id}>
                  <button
                    type="button"
                    onClick={() => onToggle?.(item.id)}
                    className="flex w-full items-center gap-2 p-1 text-left text-xs hover:bg-accent"
                  >
                    <Tile item={item} size="h-6 w-6" />
                    {item.name}
                  </button>
                </li>
              ))}
            </ul>
          </PopoverContent>
        </Popover>
      )}
    </div>
  )
}
