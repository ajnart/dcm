import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover"
import type { DockerTool } from "@/lib/docker-tools"
import { cn } from "@/lib/utils"
import { useState } from "react"

interface ServiceCirclesProps {
  className?: string
  selectedServices: DockerTool[]
  onToggleServiceSelection?: (serviceId: string) => void
  /** Spacing between service icons, defaults to -space-x-4 */
  spacing?: string
}

export const ServiceCircles = ({
  className,
  selectedServices,
  onToggleServiceSelection,
  spacing = "-space-x-4",
}: ServiceCirclesProps) => {
  const [open, setOpen] = useState(false)
  const displayedServices = selectedServices.slice(0, 9) // Show first 9 services
  const remainingServices = selectedServices.slice(9) // Store the rest for the popover
  const numRemaining = remainingServices.length

  return (
    <div className={cn("z-10 flex rtl:space-x-reverse", spacing, className)}>
      {displayedServices.map((service) => (
        <div
          key={service.id}
          className="group relative cursor-pointer select-none"
        >
          <div className="relative block">
            <div className="flex h-10 w-10 items-center justify-center overflow-hidden rounded-full! border-2 border-border bg-card ring-1 ring-primary/50 transition-all duration-200 group-hover:z-10 group-hover:scale-110 group-hover:ring-2 group-hover:ring-primary">
              {service.icon ? (
                <img
                  className="h-full w-full rounded-full! object-contain p-1.5"
                  src={service.icon}
                  width={40}
                  height={40}
                  alt={`Icon of ${service.name}`}
                  onClick={() => onToggleServiceSelection?.(service.id)}
                  onKeyDown={(e) => {
                    if (e.key === "Enter" || e.key === " ") {
                      onToggleServiceSelection?.(service.id)
                    }
                  }}
                />
              ) : (
                <div
                  className="flex h-full w-full items-center justify-center rounded-full! font-bold text-accent-text"
                  onClick={() => onToggleServiceSelection?.(service.id)}
                  onKeyDown={(e) => {
                    if (e.key === "Enter" || e.key === " ") {
                      onToggleServiceSelection?.(service.id)
                    }
                  }}
                >
                  {service.name.charAt(0)}
                </div>
              )}
            </div>
            <div className="-translate-x-1/2 pointer-events-none absolute bottom-full left-1/2 mb-2 whitespace-nowrap rounded border border-border bg-popover px-2 py-1 text-popover-foreground text-xs opacity-0 transition-opacity group-hover:opacity-100">
              {service.name}
            </div>
          </div>
        </div>
      ))}

      {numRemaining > 0 && (
        <Popover open={open} onOpenChange={setOpen}>
          <PopoverTrigger asChild>
            <button
              type="button"
              className="z-10 flex h-10 w-10 items-center justify-center rounded-full! border-2 border-border bg-card text-center text-muted-foreground text-xs transition-all duration-200 hover:z-10 hover:scale-110 hover:bg-secondary hover:text-foreground hover:ring-2 hover:ring-primary"
            >
              +{numRemaining}
            </button>
          </PopoverTrigger>
          <PopoverContent
            className="max-h-60 w-48 overflow-y-auto p-2"
            align="center"
            side="top"
          >
            <h3 className="mb-2 font-medium text-foreground text-sm">
              More services
            </h3>
            <ul className="space-y-1">
              {remainingServices.map((service) => (
                <li
                  key={service.id}
                  className="flex cursor-pointer select-none items-center gap-2 rounded p-1 hover:bg-secondary"
                  onClick={() => onToggleServiceSelection?.(service.id)}
                  onKeyDown={(e) => {
                    if (e.key === "Enter" || e.key === " ") {
                      onToggleServiceSelection?.(service.id)
                    }
                  }}
                >
                  <div className="flex h-6 w-6 items-center justify-center overflow-hidden rounded-full! border border-border bg-card">
                    {service.icon ? (
                      <img
                        className="h-full w-full rounded-full! object-contain p-1"
                        src={service.icon}
                        width={24}
                        height={24}
                        alt={`Icon of ${service.name}`}
                      />
                    ) : (
                      <div className="flex h-full w-full items-center justify-center rounded-full! font-bold text-accent-text text-xs">
                        {service.name.charAt(0)}
                      </div>
                    )}
                  </div>
                  <span className="text-foreground text-xs">
                    {service.name}
                  </span>
                </li>
              ))}
            </ul>
          </PopoverContent>
        </Popover>
      )}
    </div>
  )
}
