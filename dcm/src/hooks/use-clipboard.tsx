import { confetti } from "@/lib/confetti"
import { useCallback, useEffect, useRef, useState } from "react"
import { toast } from "sonner"

const COPIED_MS = 1500

interface UseClipboardReturn {
  copy: (text: string, origin?: Element) => Promise<boolean>
  copied: boolean
  reset: () => void
}

export function useClipboard(): UseClipboardReturn {
  const [copied, setCopied] = useState(false)
  const timer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined)

  useEffect(() => () => clearTimeout(timer.current), [])

  const reset = useCallback(() => {
    clearTimeout(timer.current)
    setCopied(false)
  }, [])

  const copy = useCallback(async (text: string, origin?: Element) => {
    try {
      if (!navigator.clipboard) {
        throw new Error("Clipboard API not available")
      }
      await navigator.clipboard.writeText(text)
    } catch (err) {
      console.error("Failed to copy: ", err)
      toast.error("Failed to copy to clipboard", {
        description: "Please ensure you're using HTTPS or localhost",
      })
      return false
    }

    clearTimeout(timer.current)
    setCopied(true)
    timer.current = setTimeout(() => setCopied(false), COPIED_MS)
    if (origin) confetti(origin)
    return true
  }, [])

  return { copy, copied, reset }
}
