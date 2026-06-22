// Ring buffer of filter snapshots for undo/redo in GraphHeaderStrip.
// Mutations push debounced (500ms) via $subscribe; back/forward gate with isRestoring.
// Scope is `filters` only — selection/pins/isolation have separate undo semantics.
import { defineStore } from 'pinia'
import { ref, computed } from 'vue'
import { useFiltersStore } from './filters.js'

const MAX = 20
const DEBOUNCE_MS = 500

// JSON deep clone — survives Pinia's reactive Proxies (structuredClone does not).
// Store values are plain objects/arrays/primitives in v2 (categorical uses
// `values: string[]`, not Set), so JSON round-trip is lossless and safe.
function deepClone(x) {
  return x == null ? x : JSON.parse(JSON.stringify(x))
}

function snapshotFrom(f) {
  return {
    nodeTypes: [...f.nodeTypes],
    edgeTypes: [...f.edgeTypes],
    degree: { mode: f.degree.mode, value: [...f.degree.value] },
    weight: { mode: f.weight.mode, value: [...f.weight.value] },
    hideIsolated: f.hideIsolated,
    hideSelfLoops: f.hideSelfLoops,
    temporalFilter: f.temporalFilter
      ? { attr: f.temporalFilter.attr, scope: f.temporalFilter.scope ?? 'node', range: [...f.temporalFilter.range] }
      : null,
    // Scoped component filter { scope, ids } | legacy array | null — JSON-safe.
    wccFilter: deepClone(f.wccFilter ?? null),
    sourceType: f.sourceType ?? null,
    targetType: f.targetType ?? null,
    nodeAttrs: deepClone(f.nodeAttrs ?? {}),
    edgeAttrs: deepClone(f.edgeAttrs ?? {}),
  }
}

function _restoreAttrs(snapAttrs, validTypes) {
  // Drop types absent from current schema. Keep all attrs within surviving types.
  const out = {}
  for (const [t, constraints] of Object.entries(snapAttrs ?? {})) {
    if (validTypes && validTypes.size && !validTypes.has(t)) continue
    out[t] = deepClone(constraints)
  }
  return out
}

function restoreInto(f, snap, schema) {
  // Extra safety check: drop types not present in the current schema.
  const validNT = new Set(schema?.node_types ?? [])
  const validET = new Set(schema?.edge_types ?? [])
  f.nodeTypes = validNT.size ? snap.nodeTypes.filter(t => validNT.has(t)) : [...snap.nodeTypes]
  f.edgeTypes = validET.size ? snap.edgeTypes.filter(t => validET.has(t)) : [...snap.edgeTypes]
  f.degree = { mode: snap.degree.mode, value: [...snap.degree.value] }
  f.weight = { mode: snap.weight.mode, value: [...snap.weight.value] }
  f.hideIsolated = snap.hideIsolated
  f.hideSelfLoops = snap.hideSelfLoops
  f.temporalFilter = snap.temporalFilter
    ? { attr: snap.temporalFilter.attr, scope: snap.temporalFilter.scope ?? 'node', range: [...snap.temporalFilter.range] }
    : null
  // The component filter has no schema-derived validity to check against (ids
  // are numeric and scope-tagged), so restore it unchanged. Older snapshots
  // without the key restore as null (filter cleared), which is the safe default.
  f.wccFilter = deepClone(snap.wccFilter ?? null)
  f.sourceType = (validNT.size && validNT.has(snap.sourceType)) ? snap.sourceType : null
  f.targetType = (validNT.size && validNT.has(snap.targetType)) ? snap.targetType : null
  f.nodeAttrs = _restoreAttrs(snap.nodeAttrs, validNT)
  f.edgeAttrs = _restoreAttrs(snap.edgeAttrs, validET)
}

export const useFilterHistoryStore = defineStore('filterHistory', () => {
  const past = ref([])  // past[length-1] is always the current state
  const future = ref([])
  let isRestoring = false
  let timer = null
  let subscribed = false

  function capture() { return snapshotFrom(useFiltersStore()) }

  function pushNow() {
    timer = null
    if (isRestoring) return
    past.value = [...past.value, capture()]
    if (past.value.length > MAX + 1) past.value.shift()
    future.value = []
  }

  function schedule() {
    if (timer) clearTimeout(timer)
    timer = setTimeout(pushNow, DEBOUNCE_MS)
  }

  function ensureSubscription() {
    if (subscribed) return
    subscribed = true
    useFiltersStore().$subscribe(() => { if (!isRestoring) schedule() })
  }

  // Seed history with the current state; starts the subscription on first call.
  function baseline() {
    if (timer) { clearTimeout(timer); timer = null }
    past.value = [capture()]
    future.value = []
    ensureSubscription()
  }

  function back(schema) {
    if (past.value.length <= 1) return
    if (timer) { clearTimeout(timer); timer = null }
    isRestoring = true
    const current = past.value[past.value.length - 1]
    future.value = [current, ...future.value]
    past.value = past.value.slice(0, -1)
    const target = past.value[past.value.length - 1]
    restoreInto(useFiltersStore(), target, schema)
    isRestoring = false
  }

  function forward(schema) {
    if (future.value.length === 0) return
    if (timer) { clearTimeout(timer); timer = null }
    isRestoring = true
    const target = future.value[0]
    future.value = future.value.slice(1)
    past.value = [...past.value, target]
    restoreInto(useFiltersStore(), target, schema)
    isRestoring = false
  }

  function clearAll() {
    if (timer) { clearTimeout(timer); timer = null }
    past.value = []
    future.value = []
  }

  const canBack = computed(() => past.value.length > 1)
  const canForward = computed(() => future.value.length > 0)

  return { past, future, canBack, canForward, baseline, back, forward, clearAll }
})
