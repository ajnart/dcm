"use client"

import { Star } from "lucide-react"

interface StarCountProps {
  count?: number
}

export function StarCount({ count }: StarCountProps) {
  const formatStars = (count?: number) => {
    if (!count) return "0"
    if (count >= 1000) {
      return `${(count / 1000).toFixed(1)}k`
    }
    return count.toString()
  }

  return (
    <div className="flex items-center gap-1 opacity-0 transition-opacity duration-300 group-hover:opacity-100">
      <span className="font-medium text-muted-foreground text-sm">
        {formatStars(count)}
      </span>
      <Star className="h-4 w-4 fill-muted-foreground text-muted-foreground" />
    </div>
  )
} 