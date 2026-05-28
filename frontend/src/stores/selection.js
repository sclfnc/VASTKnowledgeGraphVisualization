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
  // Last-overflow tracker for replaceCapped: ids dropped on the last capped
  // broadcast. Consumers (connectivity / type_mixing / edge_flow) read this to
  // surface a "+N more not selected" caption next to the broadcasting affordance.
  // Reset to 0 on any non-capped write.
  const overflow = ref(0)

  function add(id) {
    const sid = String(id)
    if (!list.value.includes(sid)) list.value.push(sid)
    overflow.value = 0
  }
  function remove(id) {
    const sid = String(id)
    const i = list.value.indexOf(sid)
    if (i !== -1) list.value.splice(i, 1)
    overflow.value = 0
  }
  function toggle(id) {
    const sid = String(id)
    const i = list.value.indexOf(sid)
    if (i === -1) list.value.push(sid)
    else list.value.splice(i, 1)
    overflow.value = 0
  }
  function clear() {
    list.value = []
    overflow.value = 0
  }
  function replace(next) {
    const seen = new Set()
    const out = []
    for (const id of next) {
      const sid = String(id)
      if (!seen.has(sid)) { seen.add(sid); out.push(sid) }
    }
    list.value = out
    overflow.value = 0
  }
  // Dedup-then-cap. Returns the truncated array for callers that want it.
  // overflow.value is set to (deduplicated total − cap) so callers can render
  // "+N more" without re-computing.
  function replaceCapped(next, cap) {
    const seen = new Set()
    const out = []
    for (const id of next) {
      const sid = String(id)
      if (!seen.has(sid)) { seen.add(sid); out.push(sid) }
    }
    const total = out.length
    const capped = cap != null && total > cap ? out.slice(0, cap) : out
    list.value = capped
    overflow.value = total - capped.length
    return capped
  }
  return { list, overflow, add, remove, toggle, clear, replace, replaceCapped }
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
    overflow: nodes.overflow,
    add: nodes.add,
    remove: nodes.remove,
    toggle: nodes.toggle,
    clear: nodes.clear,
    replace: nodes.replace,
    replaceCapped: nodes.replaceCapped,
    // Edge channel — explicit `edge*` prefix.
    edgeIds: edges.list,
    edgeOverflow: edges.overflow,
    addEdge: edges.add,
    removeEdge: edges.remove,
    toggleEdge: edges.toggle,
    clearEdges: edges.clear,
    replaceEdges: edges.replace,
    replaceEdgesCapped: edges.replaceCapped,
    // Wipe both channels at once (cross-graph teardown).
    clearAll,
  }
})
