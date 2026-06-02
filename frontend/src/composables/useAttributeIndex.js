// Reactive fetch of /attribute-index/{id} + memoized bitset builder.
//
// Backend ships per-(type, attr) buckets of node/edge indices. The composable
// turns a filter spec (`{kind, values | range | value}`) into a `Bitset` of
// the right size (N nodes or E edges). Results are memoized by a string key
// derived from (scope, type, attr, spec) so identical reactive recomputes
// don't rebuild the bitset.
//
// Scope:
//   'node' → bitset size N (from useGraphNodes)
//   'edge' → bitset size E (from useGraphEdges)
//
// Spec shapes:
//   categorical: {kind:'categorical', values: Set<string> | string[]}
//   numeric:     {kind:'numeric',     range: [lo, hi]}
//   boolean:     {kind:'boolean',     value: true | false}
//   temporal:    {kind:'date',        range: [yearLo, yearHi]}   ← `date` is the v2 alias of backend `temporal`
//                {kind:'temporal',    range: [yearLo, yearHi]}   ← also accepted for consistency
import { computed, inject, ref, toValue, watch } from 'vue'
import { apiUrl } from './useApi.js'
import { useFetch } from './useFetch.js'
import { injectGraphNodes } from './useGraphNodes.js'
import { injectGraphEdges } from './useGraphEdges.js'
import { Bitset } from '@/utils/bitset.js'
import { lowerBound, upperBound } from '@/utils/binsearch.js'

const INJECT_KEY = 'attributeIndex'

function specKey(scope, type, attr, spec) {
  if (!spec) return null
  if (spec.kind === 'categorical') {
    const vals = spec.values instanceof Set ? [...spec.values] : (spec.values ?? [])
    return `${scope}|${type}|${attr}|cat|${[...vals].sort().join(',')}`
  }
  if (spec.kind === 'numeric') return `${scope}|${type}|${attr}|num|${spec.range?.[0]}..${spec.range?.[1]}`
  if (spec.kind === 'boolean') return `${scope}|${type}|${attr}|bool|${spec.value}`
  if (spec.kind === 'date' || spec.kind === 'temporal') return `${scope}|${type}|${attr}|tmp|${spec.range?.[0]}..${spec.range?.[1]}`
  if (spec.kind === 'text') return `${scope}|${type}|${attr}|txt|${spec.mode ?? 'contains'}|${(spec.query ?? '').toLowerCase()}`
  return null
}

export function useAttributeIndex(graphId) {
  const { data, loading, error, run } = useFetch()
  const { nodes } = injectGraphNodes(graphId)
  const { edges } = injectGraphEdges(graphId)

  // Per-key memoization of constructed bitsets; cleared on payload reload.
  const bitsetCache = ref(new Map())

  async function load() {
    const id = toValue(graphId)
    if (!id) { data.value = null; bitsetCache.value = new Map(); return }
    await run(apiUrl(`/attribute-index/${id}`))
    bitsetCache.value = new Map()
  }

  watch(() => toValue(graphId), load, { immediate: true })

  function _scopeSize(scope) {
    if (scope === 'node') return nodes.value?.N ?? 0
    if (scope === 'edge') return edges.value?.E ?? 0
    return 0
  }

  function _scopePayload(scope) {
    const root = data.value
    if (!root) return null
    return scope === 'node' ? root.node_attrs : root.edge_attrs
  }

  // Build a Bitset matching a single (type, attr, spec) constraint. Returns
  // null if the constraint cannot be resolved (no payload / unknown type / unknown attr).
  function bitsetFor(scope, type, attr, spec) {
    const key = specKey(scope, type, attr, spec)
    if (!key) return null
    const cached = bitsetCache.value.get(key)
    if (cached) return cached

    const payload = _scopePayload(scope)
    if (!payload) return null
    const entry = payload[type]?.[attr]
    if (!entry) return null
    const N = _scopeSize(scope)
    const mask = new Bitset(N)

    if (entry.kind === 'categorical' && spec.kind === 'categorical') {
      const wanted = spec.values instanceof Set ? spec.values : new Set(spec.values ?? [])
      for (const [val, indices] of Object.entries(entry.values)) {
        if (!wanted.has(val)) continue
        for (const idx of indices) mask.set(idx)
      }
    } else if (entry.kind === 'numeric' && spec.kind === 'numeric') {
      const [lo, hi] = spec.range ?? []
      const sorted = entry.sorted
      // sorted is [[idx, value], ...] ascending by value; binsearch by value.
      const values = sorted.map(p => p[1])
      const li = lo == null ? 0 : lowerBound(values, lo)
      const ui = hi == null ? sorted.length : upperBound(values, hi)
      for (let k = li; k < ui; k++) mask.set(sorted[k][0])
    } else if (entry.kind === 'boolean' && spec.kind === 'boolean') {
      const bucket = spec.value === true ? entry.true : entry.false
      for (const idx of (bucket ?? [])) mask.set(idx)
    } else if (entry.kind === 'temporal' && (spec.kind === 'date' || spec.kind === 'temporal')) {
      const [lo, hi] = spec.range ?? []
      const sorted = entry.sorted
      const years = sorted.map(p => p[1])
      const li = lo == null ? 0 : lowerBound(years, lo)
      const ui = hi == null ? sorted.length : upperBound(years, hi)
      for (let k = li; k < ui; k++) mask.set(sorted[k][0])
    } else if (entry.kind === 'text' && spec.kind === 'text') {
      // entry.values is [[idx, str], ...] (not bucketed); scan locally.
      const q = (spec.query ?? '').toLowerCase()
      if (!q) return null   // empty query → no constraint (handled by caller)
      const equals = spec.mode === 'equals'
      for (const [idx, val] of entry.values) {
        const s = String(val).toLowerCase()
        if (equals ? s === q : s.includes(q)) mask.set(idx)
      }
    } else {
      return null
    }

    bitsetCache.value.set(key, mask)
    return mask
  }

  // Quick existence check for UI eligibility ("does this graph have any
  // filterable attr on type T?"). Used by NodeFilters / EdgeFilters to
  // show empty-state captions per type.
  function hasAttrsFor(scope, type) {
    const payload = _scopePayload(scope)
    if (!payload) return false
    const entry = payload[type]
    return !!entry && Object.keys(entry).length > 0
  }

  // Reverse lookup, handy for rendering the accordion: the list of
  // {attr, kind, ...} available on a given type.
  function attrsFor(scope, type) {
    const payload = _scopePayload(scope)
    if (!payload) return []
    const entry = payload[type] ?? {}
    return Object.entries(entry).map(([attr, info]) => ({ attr, ...info }))
  }

  const ready = computed(() => !!data.value)

  return { data, loading, error, ready, bitsetFor, hasAttrsFor, attrsFor }
}

export function injectAttributeIndex(graphIdFallback) {
  const provided = inject(INJECT_KEY, null)
  if (provided) return provided
  return useAttributeIndex(graphIdFallback)
}

export { INJECT_KEY as ATTRIBUTE_INDEX_KEY }
