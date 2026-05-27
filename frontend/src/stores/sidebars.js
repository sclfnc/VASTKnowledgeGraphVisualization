// Left sidebar mode toggle: 'contents' (panel list, default) or 'filters'
// (NodeFilters + EdgeFilters). The two modes share the same sidebar slot —
// the user is never in both at once, so we save horizontal space by not
// having a second persistent column. Persisted across reloads.
import { defineStore } from 'pinia'
import { useLocalStorage } from '@/composables/useLocalStorage.js'

export const useSidebarsStore = defineStore('sidebars', () => {
  const mode = useLocalStorage('sidebar_mode', 'contents')

  function setMode(next) { mode.value = next }
  function toggleMode() { mode.value = mode.value === 'contents' ? 'filters' : 'contents' }

  return { mode, setMode, toggleMode }
})
