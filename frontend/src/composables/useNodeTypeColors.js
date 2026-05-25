// Stable nodeType → color mapping; deterministic per graph since schema.node_types is sorted backend-side.
import { computed, toValue } from 'vue'

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
  const colors = computed(() => {
    const types = toValue(schemaRef)?.node_types ?? []
    const out = {}
    types.forEach((t, i) => { out[t] = PALETTE[i % PALETTE.length] })
    return out
  })

  // Falls back to neutral slate so panels never break on missing schema.
  const color = (type) => colors.value[type] ?? '#94a3b8'

  return { colors, color, palette: PALETTE }
}
