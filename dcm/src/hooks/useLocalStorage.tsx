import { useCallback, useEffect, useRef, useState } from "react"

export function useLocalStorage<T>(key: string, initialValue: T) {
  const [storedValue, setStoredValue] = useState<T>(initialValue)
  const initialRef = useRef(initialValue)

  useEffect(() => {
    const refresh = () => {
      try {
        const item = localStorage.getItem(key)
        setStoredValue(item ? JSON.parse(item) : initialRef.current)
      } catch (error) {
        console.error(`Error loading ${key} from localStorage:`, error)
      }
    }

    const onPageShow = (event: PageTransitionEvent) => {
      if (event.persisted) refresh()
    }
    const onStorage = (event: StorageEvent) => {
      if (
        event.storageArea === localStorage &&
        (event.key === key || event.key === null)
      ) {
        refresh()
      }
    }

    refresh()
    window.addEventListener("pageshow", onPageShow)
    window.addEventListener("storage", onStorage)
    return () => {
      window.removeEventListener("pageshow", onPageShow)
      window.removeEventListener("storage", onStorage)
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
