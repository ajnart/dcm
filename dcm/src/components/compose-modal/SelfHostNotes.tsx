import {
  Collapsible,
  CollapsibleContent,
  CollapsibleTrigger,
} from "@/components/ui/collapsible"
import type { ExportNote } from "@/lib/export"
import { ChevronDown, Info } from "lucide-react"

interface SelfHostNotesProps {
  notes: ExportNote[]
}

export default function SelfHostNotes({ notes }: SelfHostNotesProps) {
  if (notes.length === 0) return null

  return (
    <Collapsible defaultOpen className="mb-4 rounded border bg-muted/40">
      <CollapsibleTrigger className="group flex w-full items-center gap-2 px-3 py-2 text-left font-medium text-sm">
        <Info className="h-4 w-4 text-accent-text" />
        Notes for {notes.length} selected service
        {notes.length !== 1 ? "s" : ""}
        <ChevronDown className="ml-auto h-4 w-4 transition-transform group-data-[state=open]:rotate-180" />
      </CollapsibleTrigger>
      <CollapsibleContent>
        <ul className="max-h-36 space-y-2 overflow-y-auto border-t px-3 py-2 text-muted-foreground text-xs">
          {notes.map((note) => (
            <li key={note.id} className="break-words">
              <span className="font-mono font-semibold text-foreground">
                {note.name}
              </span>
              : {note.text}
            </li>
          ))}
        </ul>
      </CollapsibleContent>
    </Collapsible>
  )
}
