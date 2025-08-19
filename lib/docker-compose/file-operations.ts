import type { DockerSettings } from "@/components/settings-panel"
import type { DockerTool } from "@/lib/docker-tools"
import { copyTextToClipboard } from "@/lib/clipboard-utils"
import posthog from "posthog-js"
import { toast } from "sonner"

export async function copyToClipboard(
  content: string,
  fileType: "compose" | "env",
  selectedTools: DockerTool[],
  settings: DockerSettings,
): Promise<boolean> {
  try {
    const successful = await copyTextToClipboard(content)
    
    if (!successful) {
      throw new Error("Failed to copy content to clipboard")
    }

    toast.success(
      `${fileType === "compose" ? "Docker Compose" : ".env"} file copied to clipboard`,
      {
        description: `${selectedTools.length} service${selectedTools.length !== 1 ? "s" : ""} configuration copied.`,
        duration: 3000,
      },
    )

    posthog.capture("copy_compose_success", {
      selected_tools: selectedTools.map((t) => t.id),
      settings: settings,
      file_type: fileType,
    })

    return true
  } catch (err) {
    console.error("Failed to copy: ", err)

    toast.error("Failed to copy to clipboard", {
      description:
        err instanceof Error ? err.message : "An error occurred while copying",
      duration: 5000,
    })

    return false
  }
}

export function downloadFile(
  content: string,
  fileType: "compose" | "env",
  selectedTools: DockerTool[],
  settings: DockerSettings,
): void {
  const filename = fileType === "compose" ? "docker-compose.yaml" : ".env"

  try {
    const blob = new Blob([content], { type: "text/plain" })
    const url = URL.createObjectURL(blob)
    const a = document.createElement("a")
    a.href = url
    a.download = filename
    document.body.appendChild(a)
    a.click()

    toast.success(`${filename} downloaded`, {
      description: "File has been downloaded to your computer.",
      duration: 3000,
    })

    setTimeout(() => {
      document.body.removeChild(a)
      URL.revokeObjectURL(url)
    }, 100)

    posthog.capture("download_compose_file", {
      selected_tools: selectedTools.map((t) => t.id),
      settings: settings,
      file_type: fileType,
    })
  } catch (err) {
    console.error("Failed to download file: ", err)

    toast.error("Failed to download file", {
      description:
        err instanceof Error
          ? err.message
          : "An error occurred while downloading",
      duration: 5000,
    })
  }
}
