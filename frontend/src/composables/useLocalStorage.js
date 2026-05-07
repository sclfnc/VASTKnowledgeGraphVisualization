// EXTENSION: ref auto-persisted to localStorage. Refs are cached per key so multiple
// callers using the same key share state — without the cache, writes from one caller
// would not propagate to other callers' refs until a page reload.
import { ref, watch } from 'vue'

const cache = new Map()

export function useLocalStorage(key, defaultValue) {
  const existing = cache.get(key)
  if (existing) return existing

  const stored = localStorage.getItem(key)
  let initial = defaultValue
  if (stored !== null) {
    try { initial = JSON.parse(stored) } catch { initial = stored }
  }
  const state = ref(initial)

  watch(state, (val) => {
    if (val === null || val === undefined) localStorage.removeItem(key)
    else localStorage.setItem(key, JSON.stringify(val))
  }, { deep: true })

  cache.set(key, state)
  return state
}
