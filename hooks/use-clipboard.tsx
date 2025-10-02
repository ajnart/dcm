"use client"

import { useState, useCallback } from "react"

interface UseClipboardReturn {
  value: string | null
  copy: (text: string) => Promise<boolean>
  copied: boolean
  error: Error | null
}

export function useClipboard(): UseClipboardReturn {
  const [value, setValue] = useState<string | null>(null)
  const [copied, setCopied] = useState(false)
  const [error, setError] = useState<Error | null>(null)

  const copy = useCallback(async (text: string): Promise<boolean> => {
    if (!navigator?.clipboard) {
      setError(new Error("Clipboard API not available"))
      return false
    }

    try {
      await navigator.clipboard.writeText(text)
      setValue(text)
      setCopied(true)
      setError(null)

      // Reset copied state after 2 seconds
      setTimeout(() => {
        setCopied(false)
      }, 2000)

      return true
    } catch (err) {
      setError(err instanceof Error ? err : new Error("Failed to copy"))
      setCopied(false)
      return false
    }
  }, [])

  return { value, copy, copied, error }
}
