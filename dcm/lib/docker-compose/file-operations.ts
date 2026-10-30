import type { DockerTool } from "@/lib/docker-tools"
import { toast } from "sonner"

export async function copyToClipboard(
  content: string,
  fileType: "compose" | "env",
  selectedTools: DockerTool[],
): Promise<boolean> {
  try {
    // Check if we're in a secure context and clipboard API is available
    if (!navigator.clipboard) {
      throw new Error(
        "Clipboard API not available. This feature requires HTTPS or localhost.",
      )
    }

    await navigator.clipboard.writeText(content)

    toast.success(
      `${fileType === "compose" ? "Docker Compose" : ".env"} file copied to clipboard`,
      {
        description: `${selectedTools.length} service${selectedTools.length !== 1 ? "s" : ""} configuration copied.`,
        duration: 3000,
      },
    )

    return true
  } catch (err) {
    console.error("Failed to copy: ", err)

    const errorMessage =
      err instanceof Error ? err.message : "An error occurred while copying"
    toast.error("Failed to copy to clipboard", {
      description: errorMessage.includes("not available")
        ? "Please ensure you're using HTTPS or localhost"
        : errorMessage,
      duration: 5000,
    })

    return false
  }
}

export function downloadFile(
  content: string,
  fileType: "compose" | "env",
  selectedTools: DockerTool[],
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
