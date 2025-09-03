"use client"

import { useCallback, useState } from "react"

interface UseClipboardOptions {
  timeout?: number
}

interface UseClipboardReturn {
  isLoading: boolean
  isSuccess: boolean
  error: string | null
  copyToClipboard: (text: string) => Promise<boolean>
  reset: () => void
}

export function useClipboard(options: UseClipboardOptions = {}): UseClipboardReturn {
  const { timeout = 2000 } = options
  const [isLoading, setIsLoading] = useState(false)
  const [isSuccess, setIsSuccess] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const reset = useCallback(() => {
    setIsLoading(false)
    setIsSuccess(false)
    setError(null)
  }, [])

  const copyToClipboard = useCallback(async (text: string): Promise<boolean> => {
    if (!text) {
      setError("No text provided")
      return false
    }

    setIsLoading(true)
    setError(null)
    setIsSuccess(false)

    try {
      // Check if we're in a secure context (HTTPS or localhost)
      if (!navigator.clipboard) {
        throw new Error("Clipboard API not available. This feature requires HTTPS or localhost.")
      }

      await navigator.clipboard.writeText(text)
      
      setIsSuccess(true)
      setIsLoading(false)
      
      // Reset success state after timeout
      setTimeout(() => {
        setIsSuccess(false)
      }, timeout)

      return true
    } catch (err) {
      const errorMessage = err instanceof Error ? err.message : "Failed to copy to clipboard"
      setError(errorMessage)
      setIsLoading(false)
      return false
    }
  }, [timeout])

  return {
    isLoading,
    isSuccess,
    error,
    copyToClipboard,
    reset
  }
}