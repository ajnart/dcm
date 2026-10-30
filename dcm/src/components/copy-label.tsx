import { cn } from "@/lib/utils"
import { Check } from "lucide-react"
import type { ReactNode } from "react"

interface CopyLabelProps {
  copied: boolean
  icon: ReactNode
  label: string
  labelClassName?: string
}

export function CopyLabel({
  copied,
  icon,
  label,
  labelClassName,
}: CopyLabelProps) {
  return (
    <>
      {copied ? (
        <Check className="text-ok motion-safe:animate-scale-in" />
      ) : (
        icon
      )}
      <span
        aria-live="polite"
        className={cn("min-w-[6ch] text-left", labelClassName)}
      >
        {copied ? "Copied" : label}
      </span>
    </>
  )
}
