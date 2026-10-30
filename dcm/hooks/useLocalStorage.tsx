"use client"

import { useCallback, useEffect, useRef, useState } from "react"

export function useLocalStorage<T>(key: string, initialValue: T) {
  const [storedValue, setStoredValue] = useState<T>(initialValue)
  const initialRef = useRef(initialValue)

  useEffect(() => {
    try {
      const item = localStorage.getItem(key)
      if (item) setStoredValue(JSON.parse(item))
    } catch (error) {
      console.error(`Error loading ${key} from localStorage:`, error)
    }
  }, [key])

  const setValue = useCallback(
    (value: T) => {
      setStoredValue(value)
      try {
        localStorage.setItem(key, JSON.stringify(value))
      } catch (error) {
        console.error(`Error saving ${key} to localStorage:`, error)
      }
    },
    [key],
  )

  const removeValue = useCallback(() => {
    setStoredValue(initialRef.current)
    try {
      localStorage.removeItem(key)
    } catch (error) {
      console.error(`Error removing ${key} from localStorage:`, error)
    }
  }, [key])

  return { value: storedValue, setValue, removeValue }
}
