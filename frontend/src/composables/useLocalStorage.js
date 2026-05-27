// EXTENSION: ref auto-persisted to localStorage. Refs are cached per key so multiple
// callers using the same key share state — without the cache, writes from one caller
// would not propagate to other callers' refs until a page reload.
//
// Defensive against localStorage failure modes:
//   - Safari incognito throws on access (SecurityError)
//   - quota exceeded on write (QuotaExceededError)
//   - non-JSON values from another origin or older app version
// Falling back to an in-memory ref keeps the app functional without persistence.
import { ref, watch } from 'vue'

const cache = new Map()

function safeGet(key) {
  try { return localStorage.getItem(key) } catch { return null }
}

function safeSet(key, val) {
  try { localStorage.setItem(key, val) } catch { /* quota / disabled */ }
}

function safeRemove(key) {
  try { localStorage.removeItem(key) } catch { /* disabled */ }
}

export function useLocalStorage(key, defaultValue) {
  const existing = cache.get(key)
  if (existing) return existing

  const stored = safeGet(key)
  let initial = defaultValue
  if (stored !== null) {
    try { initial = JSON.parse(stored) } catch { initial = stored }
  }
  const state = ref(initial)

  watch(state, (val) => {
    if (val === null || val === undefined) safeRemove(key)
    else {
      let serialized
      try { serialized = JSON.stringify(val) } catch { return }  // cycle / BigInt
      safeSet(key, serialized)
    }
  }, { deep: true })

  cache.set(key, state)
  return state
}
