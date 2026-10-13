"use client"

import {
  CommandDialog,
  CommandEmpty,
  CommandGroup,
  CommandInput,
  CommandItem,
  CommandList,
} from "@/components/ui/command"
import { DialogTitle } from "@/components/ui/dialog"
import type { Catalog } from "@/lib/catalog"
import { Check } from "lucide-react"
import { useEffect, useState } from "react"

interface SearchCommandProps {
  catalog: Catalog
  selected: string[]
  onToggle: (id: string) => void
}

export function SearchCommand({
  catalog,
  selected,
  onToggle,
}: SearchCommandProps) {
  const [open, setOpen] = useState(false)

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
      <DialogTitle className="sr-only">Search apps and recipes</DialogTitle>
      <CommandInput placeholder="Search apps and recipes..." />
      <CommandList>
        <CommandEmpty>Nothing found.</CommandEmpty>

        <CommandGroup heading="Recipes">
          {catalog.recipes.map((recipe) => (
            <CommandItem
              key={recipe.id}
              value={`recipe ${recipe.name} ${recipe.id}`}
              onSelect={() => onToggle(recipe.id)}
              className="flex items-center justify-between"
            >
              <span className="text-gold">{recipe.name}</span>
              <span className="flex items-center gap-2 text-dim text-xs">
                {recipe.apps.length} apps
                {selected.includes(recipe.id) && (
                  <Check className="h-4 w-4 text-pink" />
                )}
              </span>
            </CommandItem>
          ))}
        </CommandGroup>

        <CommandGroup heading="Apps">
          {catalog.entries.map((entry) => (
            <CommandItem
              key={entry.id}
              value={`${entry.name} ${entry.id} ${entry.category}`}
              onSelect={() => onToggle(entry.id)}
              disabled={entry.isUnsupported}
              className="flex items-center justify-between"
            >
              <span className="flex items-center gap-2">
                <span className="flex h-6 w-6 items-center justify-center overflow-hidden border border-line bg-deep text-pink text-xs">
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
                {entry.selfhostOnly && (
                  <span className="text-pink">self-host only</span>
                )}
                {entry.isUnsupported && (
                  <span className="text-red">unsupported</span>
                )}
                {selected.includes(entry.id) && (
                  <Check className="h-4 w-4 text-pink" />
                )}
              </span>
            </CommandItem>
          ))}
        </CommandGroup>
      </CommandList>
    </CommandDialog>
  )
}
