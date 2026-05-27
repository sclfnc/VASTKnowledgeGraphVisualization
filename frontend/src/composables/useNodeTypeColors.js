// Stable nodeType → color mapping; deterministic per graph since the effective
// type list (auto-promoted or raw) is sorted lexicographically client-side.
//
// When auto_promoted.node is active (e.g. Karate's `club`), the type list is
// the unique effective labels ('Mr. Hi', 'Officer') instead of the raw
// `Node Type` (which would degenerate to a single `Unknown`). Falls back to
// `schema.node_types` when no effective list is available.
import { computed, toValue } from 'vue'
import { injectEffectiveTypes } from './useEffectiveTypes.js'

// Tableau10 — high distinguishability at small sizes; wraps past 10 types.
const PALETTE = [
  '#4e79a7', // blue
  '#f28e2c', // orange
  '#e15759', // red
  '#76b7b2', // teal
  '#59a14f', // green
  '#edc949', // yellow
  '#af7aa1', // purple
  '#ff9da7', // pink
  '#9c755f', // brown
  '#bab0ab', // grey
]

export function useNodeTypeColors(schemaRef) {
  const { data: effData } = injectEffectiveTypes()

  const types = computed(() => {
    const labels = effData.value?.node
    if (Array.isArray(labels) && labels.length) {
      const seen = new Set()
      for (const l of labels) seen.add(l)
      return [...seen].sort()
    }
    return toValue(schemaRef)?.node_types ?? []
  })

  const colors = computed(() => {
    const out = {}
    types.value.forEach((t, i) => { out[t] = PALETTE[i % PALETTE.length] })
    return out
  })

  // Falls back to neutral slate so panels never break on missing schema.
  const color = (type) => colors.value[type] ?? '#94a3b8'

  return { colors, color, palette: PALETTE, types }
}
