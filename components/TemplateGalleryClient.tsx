"use client"

import FloatingBar from "@/components/floating-bar"
import SettingsPanel from "@/components/settings-panel"
import { TemplateGallery } from "@/components/template-gallery"
import { Button } from "@/components/ui/button"
import { useLocalStorage } from "@/hooks/useLocalStorage"
import { STORAGE_KEYS } from "@/lib/constants"
import type { DockerTool } from "@/lib/docker-tools"
import { SettingsProvider } from "@/lib/settings-context"
import type { Template } from "@/lib/templates"
import { ArrowLeft } from "lucide-react"
import Link from "next/link"
import { useRouter } from "next/navigation"
import { useState } from "react"

interface TemplateGalleryClientProps {
  dockerTools: DockerTool[]
}

export default function TemplateGalleryClient({
  dockerTools,
}: TemplateGalleryClientProps) {
  const router = useRouter()

  const {
    value: storedTools,
    setValue: setStoredTools,
    removeValue: clearStoredTools,
  } = useLocalStorage<string[]>(STORAGE_KEYS.SELECTED_TOOLS, [])

  // Track selected template IDs
  const [selectedTemplateIds, setSelectedTemplateIds] = useState<string[]>([])

  // Get the DockerTool objects for selected tools
  const selectedToolObjects = storedTools
    .map((id) => dockerTools.find((tool) => tool.id === id))
    .filter((tool): tool is DockerTool => tool !== undefined)

  const handleSelectTemplate = (tools: DockerTool[], template: Template) => {
    // Get IDs of tools in the template
    const templateToolIds = tools.map((tool) => tool.id)

    // Merge with existing selections, avoiding duplicates
    const newSelection = [...new Set([...storedTools, ...templateToolIds])]

    // Update localStorage
    setStoredTools(newSelection)

    // Add template ID to selected templates
    setSelectedTemplateIds((prev) => [...prev, template.id])
  }

  const handleUnselectTemplate = (toolIds: string[], templateId: string) => {
    // Filter out the tools to be removed
    const newSelection = storedTools.filter((id) => !toolIds.includes(id))

    // Update localStorage
    setStoredTools(newSelection)

    // Remove template ID from selected templates
    setSelectedTemplateIds((prev) => prev.filter((id) => id !== templateId))
  }

  const handleReset = () => {
    clearStoredTools()
    setSelectedTemplateIds([])
  }

  return (
    <SettingsProvider>
      <div className="mb-6 flex items-center justify-between">
        <Button asChild variant="ghost" className="flex items-center gap-2">
          <Link prefetch href="/">
            <ArrowLeft size={16} />
            Back to Container Selection
          </Link>
        </Button>
      </div>

      <div className="[animation-delay:300ms] motion-safe:animate-slide-down">
        <SettingsPanel />
      </div>

      <FloatingBar
        selectedCount={storedTools.length}
        selectedTools={storedTools.map(
          (id) => dockerTools.find((tool) => tool.id === id)?.name || "",
        )}
        selectedToolIds={storedTools}
        selectedToolObjects={selectedToolObjects}
        onReset={handleReset}
      />

      <TemplateGallery
        allTools={dockerTools}
        onSelectTemplate={handleSelectTemplate}
        onUnselectTemplate={handleUnselectTemplate}
        selectedTools={selectedToolObjects}
        selectedTemplateIds={selectedTemplateIds}
      />
    </SettingsProvider>
  )
}
