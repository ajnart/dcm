"use client"

import SettingsPanel from "@/components/settings-panel"
import { Button } from "@/components/ui/button"
import { useState } from "react"

export default function EmbeddedSettings() {
  const [isVisible, setIsVisible] = useState(false)

  return (
    <div className="mb-4">
      <div className="flex items-center justify-between">
        <Button
          variant="outline"
          size="sm"
          onClick={() => setIsVisible(!isVisible)}
          className="flex-1"
        >
          {isVisible ? "Hide settings" : "Show settings"}
        </Button>
      </div>

      {isVisible && (
        <div className="mt-4">
          <SettingsPanel isEmbedded className="rounded-md border p-4" />
        </div>
      )}
    </div>
  )
}
