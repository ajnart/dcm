import Providers from "@/components/Providers"
import FloatingBar from "@/components/floating-bar"
import SettingsPanel from "@/components/settings-panel"
import { TemplateGallery } from "@/components/template-gallery"
import { Button } from "@/components/ui/button"
import { useCatalogView } from "@/hooks/use-catalog-view"
import { type Catalog, type CatalogEntry, allTemplates } from "@/lib/catalog"
import { routes } from "@/lib/routes"
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
  const { selection, entries, visibleIds, hiddenCount } = useCatalogView(
    catalog,
    "compose",
  )
  const [selectedTemplateIds, setSelectedTemplateIds] = useState<string[]>([])

  const visibleTemplates = useMemo(
    () => allTemplates(catalog, templates, "compose"),
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
          <a href={routes.compose}>
            <ArrowLeft size={16} />
            Back to Container Selection
          </a>
        </Button>
      </div>

      <div className="[animation-delay:300ms] motion-safe:animate-slide-down">
        <SettingsPanel />
      </div>

      <FloatingBar
        catalog={catalog}
        entries={entries}
        mode="compose"
        ids={visibleIds}
        shareIds={selection.ids}
        hiddenCount={hiddenCount}
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
