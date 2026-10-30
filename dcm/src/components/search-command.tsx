import {
  CommandDialog,
  CommandEmpty,
  CommandGroup,
  CommandInput,
  CommandItem,
  CommandList,
} from "@/components/ui/command"
import { DialogTitle } from "@/components/ui/dialog"
import type { CatalogEntry } from "@/lib/catalog"
import { track } from "@/lib/track"
import { Check } from "lucide-react"
import { useEffect, useState } from "react"

interface SearchCommandProps {
  entries: CatalogEntry[]
  selected: string[]
  onToggle: (id: string) => void
}

export function SearchCommand({
  entries,
  selected,
  onToggle,
}: SearchCommandProps) {
  const [open, setOpen] = useState(false)

  useEffect(() => {
    if (open) track({ name: "dcm_search_opened" })
  }, [open])

  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === "k" && (e.metaKey || e.ctrlKey)) {
        e.preventDefault()
        setOpen((value) => !value)
      }
    }
    const handleCustomTrigger = () => setOpen((value) => !value)

    document.addEventListener("keydown", handleKeyDown)
    document.addEventListener("triggerCommandK", handleCustomTrigger)
    return () => {
      document.removeEventListener("keydown", handleKeyDown)
      document.removeEventListener("triggerCommandK", handleCustomTrigger)
    }
  }, [])

  return (
    <CommandDialog open={open} onOpenChange={setOpen}>
      <DialogTitle className="sr-only">Search apps</DialogTitle>
      <CommandInput placeholder="Search apps..." />
      <CommandList>
        <CommandEmpty>Nothing found.</CommandEmpty>

        <CommandGroup heading="Apps">
          {entries.map((entry) => (
            <CommandItem
              key={entry.id}
              value={`${entry.name} ${entry.id} ${entry.category}`}
              onSelect={() => onToggle(entry.id)}
              disabled={entry.isUnsupported}
              className="flex items-center justify-between"
            >
              <span className="flex items-center gap-2">
                <span className="flex h-6 w-6 items-center justify-center overflow-hidden rounded-sm text-muted-foreground text-xs">
                  {entry.icon ? (
                    <img
                      src={entry.icon}
                      alt=""
                      className="h-full w-full object-contain p-0.5"
                    />
                  ) : (
                    entry.name.charAt(0)
                  )}
                </span>
                {entry.name}
              </span>
              <span className="flex items-center gap-2 text-xs">
                {entry.selfhostId && (
                  <span className="text-accent-text">self-host</span>
                )}
                {entry.isUnsupported && (
                  <span className="text-destructive">unsupported</span>
                )}
                {selected.includes(entry.id) && (
                  <Check className="h-4 w-4 text-accent-text" />
                )}
              </span>
            </CommandItem>
          ))}
        </CommandGroup>
      </CommandList>
    </CommandDialog>
  )
}
