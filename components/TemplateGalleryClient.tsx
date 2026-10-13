"use client"

import FloatingBar from "@/components/floating-bar"
import SettingsPanel from "@/components/settings-panel"
import { TemplateGallery } from "@/components/template-gallery"
import { Button } from "@/components/ui/button"
import { useSelection } from "@/hooks/use-selection"
import type { Catalog, CatalogEntry } from "@/lib/catalog"
import type { Template } from "@/lib/templates"
import { ArrowLeft } from "lucide-react"
import Link from "next/link"
import { useState } from "react"

interface TemplateGalleryClientProps {
  catalog: Catalog
}

export default function TemplateGalleryClient({
  catalog,
}: TemplateGalleryClientProps) {
  const selection = useSelection()
  const [selectedTemplateIds, setSelectedTemplateIds] = useState<string[]>([])

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

  const toggle = (id: string) => selection.toggle(id)

  return (
    <div className="container pt-6 pb-8">
      <div className="mb-6">
        <Button asChild variant="ghost" className="flex items-center gap-2">
          <Link prefetch={false} href="/">
            <ArrowLeft size={16} />
            Back to Container Selection
          </Link>
        </Button>
      </div>

      <SettingsPanel />

      <FloatingBar
        catalog={catalog}
        ids={selection.ids}
        onToggle={toggle}
        onClear={handleClear}
      />

      <TemplateGallery
        allTools={catalog.entries}
        onSelectTemplate={handleSelectTemplate}
        onUnselectTemplate={handleUnselectTemplate}
        selectedTools={selectedEntries}
        selectedTemplateIds={selectedTemplateIds}
      />
    </div>
  )
}
