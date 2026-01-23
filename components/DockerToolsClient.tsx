"use client"

import ToolGrid from "@/components/ToolGrid"
import FloatingBar from "@/components/floating-bar"
import SettingsPanel from "@/components/settings-panel"
import { Button } from "@/components/ui/button"
import { useLocalStorage } from "@/hooks/useLocalStorage"
import { STORAGE_KEYS } from "@/lib/constants"
import type { DockerTool } from "@/lib/docker-tools"
import { SettingsProvider } from "@/lib/settings-context"
import { decodeShareUrl } from "@/lib/url-utils"
import { Palette } from "lucide-react"
import Link from "next/link"
import { useRouter, useSearchParams } from "next/navigation"
import { useEffect, useRef } from "react"

interface DockerToolsClientProps {
  dockerTools: DockerTool[]
}

export default function DockerToolsClient({
  dockerTools,
}: DockerToolsClientProps) {
  const router = useRouter()
  const searchParams = useSearchParams()
  const processedShareRef = useRef(false)

  const {
    value: storedTools,
    setValue: setStoredTools,
    removeValue: clearStoredTools,
  } = useLocalStorage<string[]>(STORAGE_KEYS.SELECTED_TOOLS, [])

  // Get tools from share parameter if available
  const shareParam = searchParams.get("share")

  // Determine which tool IDs to use, prioritizing share parameter
  const selectedTools = shareParam ? decodeShareUrl(shareParam) : storedTools

  // Process share parameter only once
  useEffect(() => {
    if (shareParam && !processedShareRef.current) {
      processedShareRef.current = true
      const decodedTools = decodeShareUrl(shareParam)
      setStoredTools(decodedTools)

      // Redirect to root URL after loading from share
      router.push("/")
    }
  }, [shareParam, setStoredTools, router])

  const toggleToolSelection = (toolId: string) => {
    const tool = dockerTools.find((t) => t.id === toolId)
    if (tool?.isUnsupported) {
      return
    }

    const newSelectedTools = selectedTools.includes(toolId)
      ? selectedTools.filter((id) => id !== toolId)
      : [...selectedTools, toolId]

    // Update localStorage only
    setStoredTools(newSelectedTools)
  }

  const handleReset = () => {
    clearStoredTools()
  }

  // Get the DockerTool objects for selected tools
  const selectedToolObjects = selectedTools
    .map((id) => dockerTools.find((tool) => tool.id === id))
    .filter((tool): tool is DockerTool => tool !== undefined)

  return (
    <SettingsProvider>
      <div className="mb-6 flex items-center justify-between">
        <h1 className="font-bold text-3xl">Docker Compose Maker</h1>
        <Button asChild className="flex items-center gap-2">
          <Link prefetch href="/templates">
            <Palette size={16} />
            Template Gallery
          </Link>
        </Button>
      </div>

      <div className="[animation-delay:300ms] motion-safe:animate-slide-down">
        <SettingsPanel />
      </div>

      <FloatingBar
        selectedCount={selectedTools.length}
        selectedTools={selectedTools.map(
          (id) => dockerTools.find((tool) => tool.id === id)?.name || "",
        )}
        selectedToolIds={selectedTools}
        selectedToolObjects={selectedToolObjects}
        onReset={handleReset}
        onToggleToolSelection={toggleToolSelection}
      />

      <ToolGrid
        tools={dockerTools}
        selectedTools={selectedTools}
        onToggleSelection={toggleToolSelection}
      />
    </SettingsProvider>
  )
}
