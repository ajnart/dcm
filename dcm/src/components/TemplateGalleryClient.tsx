import { ModeToggle } from "@/components/ModeToggle"
import Providers from "@/components/Providers"
import FloatingBar from "@/components/floating-bar"
import SettingsPanel from "@/components/settings-panel"
import { TemplateGallery } from "@/components/template-gallery"
import { Button } from "@/components/ui/button"
import { useMode } from "@/hooks/use-mode"
import { useSelection } from "@/hooks/use-selection"
import { withBase } from "@/lib/base"
import {
  type Catalog,
  type CatalogEntry,
  allTemplates,
  entriesForMode,
} from "@/lib/catalog"
import type { Template } from "@/lib/templates"
import { ArrowLeft } from "lucide-react"
import { useMemo, useState } from "react"

interface TemplateGalleryClientProps {
  catalog: Catalog
  templates: Template[]
}

function TemplateGalleryView({
  catalog,
  templates,
}: TemplateGalleryClientProps) {
  const [mode, setMode] = useMode()
  const selection = useSelection()
  const [selectedTemplateIds, setSelectedTemplateIds] = useState<string[]>([])

  const entries = useMemo(() => entriesForMode(catalog, mode), [catalog, mode])
  const visibleTemplates = useMemo(
    () => allTemplates(catalog, templates, mode),
    [catalog, templates, mode],
  )
  const counts = useMemo(
    () => ({
      "self-host": allTemplates(catalog, templates, "self-host").length,
      all: allTemplates(catalog, templates, "all").length,
    }),
    [catalog, templates],
  )

  const selectedEntries = selection.ids
    .map((id) => catalog.entries.find((entry) => entry.id === id))
    .filter((entry): entry is CatalogEntry => entry !== undefined)

  const handleSelectTemplate = (tools: CatalogEntry[], template: Template) => {
    selection.add(tools.map((tool) => tool.id))
    setSelectedTemplateIds((prev) => [...prev, template.id])
  }

  const handleUnselectTemplate = (toolIds: string[], templateId: string) => {
    selection.remove(toolIds)
    setSelectedTemplateIds((prev) => prev.filter((id) => id !== templateId))
  }

  const handleClear = () => {
    selection.clear()
    setSelectedTemplateIds([])
  }

  return (
    <>
      <div className="mb-6 flex flex-wrap items-center justify-between gap-4">
        <Button asChild variant="ghost" className="flex items-center gap-2">
          <a href={withBase("/")}>
            <ArrowLeft size={16} />
            Back to Container Selection
          </a>
        </Button>
        <ModeToggle mode={mode} counts={counts} onChange={setMode} />
      </div>

      <div className="[animation-delay:300ms] motion-safe:animate-slide-down">
        <SettingsPanel />
      </div>

      <FloatingBar
        catalog={catalog}
        entries={entries}
        mode={mode}
        ids={selection.ids}
        onToggle={selection.toggle}
        onClear={handleClear}
      />

      <TemplateGallery
        templates={visibleTemplates}
        allTools={catalog.entries}
        onSelectTemplate={handleSelectTemplate}
        onUnselectTemplate={handleUnselectTemplate}
        selectedTools={selectedEntries}
        selectedTemplateIds={selectedTemplateIds}
      />
    </>
  )
}

export default function TemplateGalleryClient(
  props: TemplateGalleryClientProps,
) {
  return (
    <Providers>
      <TemplateGalleryView {...props} />
    </Providers>
  )
}
