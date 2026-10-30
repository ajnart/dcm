import { useLocalStorage } from "@/hooks/useLocalStorage"
import { STORAGE_KEYS } from "@/lib/constants"

export function useSelection() {
  const {
    value: ids,
    setValue: setIds,
    removeValue: clear,
  } = useLocalStorage<string[]>(STORAGE_KEYS.SELECTED_TOOLS, [])

  const toggle = (id: string) =>
    setIds(ids.includes(id) ? ids.filter((item) => item !== id) : [...ids, id])

  const add = (added: string[]) => setIds([...new Set([...ids, ...added])])

  const remove = (removed: string[]) =>
    setIds(ids.filter((id) => !removed.includes(id)))

  return { ids, set: setIds, toggle, add, remove, clear }
}
