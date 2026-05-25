// Cross-panel selection store. Unbounded — consumers cap on read (e.g. EgoComparison).
import { defineStore } from 'pinia'
import { ref } from 'vue'

// Canonical home for EgoComparison's pie cap; store itself doesn't enforce it.
export const MAX_LAYERS = 4

// Per-panel caps for aggregate selection broadcasts; keyed by panelSpec.id.
export const SELECTION_CAPS = {
  type_mixing: 100,
  edge_flow: 200,
  connectivity: 500,
}

export const useSelectionStore = defineStore('selection', () => {
  const ids = ref([])

  function add(id) {
    const sid = String(id)
    if (!ids.value.includes(sid)) ids.value.push(sid)
  }

  function remove(id) {
    const sid = String(id)
    const i = ids.value.indexOf(sid)
    if (i !== -1) ids.value.splice(i, 1)
  }

  function toggle(id) {
    const sid = String(id)
    const i = ids.value.indexOf(sid)
    if (i === -1) ids.value.push(sid)
    else ids.value.splice(i, 1)
  }

  function clear() {
    ids.value = []
  }

  // Destructive replace; callers must cap (store stays unbounded).
  function replace(next) {
    ids.value = Array.from(next, (id) => String(id))
  }

  return { ids, add, remove, toggle, clear, replace }
})
