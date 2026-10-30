import { toast } from "sonner"
import { EXPORT_FILENAMES } from "./types"

export function downloadFile(
  content: string,
  fileType: keyof typeof EXPORT_FILENAMES,
): void {
  const filename = EXPORT_FILENAMES[fileType]

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
