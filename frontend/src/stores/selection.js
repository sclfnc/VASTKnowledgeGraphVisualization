// Cross-panel selection store. Unbounded — consumers cap on read (e.g. EgoComparison).
//
// Two parallel channels: `ids` for nodes, `edgeIds` for edges. They share the
// same shape (string[]) and the same mutator API (add/remove/toggle/replace/clear),
// but are kept separate because most consumers care about exactly one of the
// two. `clearAll` wipes both at once.
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

function makeChannel() {
  const list = ref([])

  function add(id) {
    const sid = String(id)
    if (!list.value.includes(sid)) list.value.push(sid)
  }
  function remove(id) {
    const sid = String(id)
    const i = list.value.indexOf(sid)
    if (i !== -1) list.value.splice(i, 1)
  }
  function toggle(id) {
    const sid = String(id)
    const i = list.value.indexOf(sid)
    if (i === -1) list.value.push(sid)
    else list.value.splice(i, 1)
  }
  function clear() {
    list.value = []
  }
  function replace(next) {
    const seen = new Set()
    const out = []
    for (const id of next) {
      const sid = String(id)
      if (!seen.has(sid)) { seen.add(sid); out.push(sid) }
    }
    list.value = out
  }
  return { list, add, remove, toggle, clear, replace }
}

export const useSelectionStore = defineStore('selection', () => {
  const nodes = makeChannel()
  const edges = makeChannel()

  function clearAll() {
    nodes.clear()
    edges.clear()
  }

  return {
    // Node channel — kept under the historic names so existing callers don't move.
    ids: nodes.list,
    add: nodes.add,
    remove: nodes.remove,
    toggle: nodes.toggle,
    clear: nodes.clear,
    replace: nodes.replace,
    // Edge channel — explicit `edge*` prefix.
    edgeIds: edges.list,
    addEdge: edges.add,
    removeEdge: edges.remove,
    toggleEdge: edges.toggle,
    clearEdges: edges.clear,
    replaceEdges: edges.replace,
    // Wipe both channels at once (cross-graph teardown).
    clearAll,
  }
})
