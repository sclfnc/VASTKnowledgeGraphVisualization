// Stable nodeType → color mapping shared across panels and chips.
//
// Backend returns `schema.node_types` already sorted (api/main.py compute_schema),
// so the mapping is deterministic for a given graph. We pick from a fixed
// palette in order; if the graph has more types than the palette length, we
// wrap around (rare — Tableau10 covers 10 types, most graphs have ≤ 6).
import { computed, toValue } from 'vue'

// Tableau10: chosen for high distinguishability at small sizes (chips, dots).
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
  // Map { type: color } — deterministic across mounts as long as schema is the same.
  const colors = computed(() => {
    const types = toValue(schemaRef)?.node_types ?? []
    const out = {}
    types.forEach((t, i) => { out[t] = PALETTE[i % PALETTE.length] })
    return out
  })

  // d3-style accessor: `color('Person')` returns the hex. Falls back to a
  // neutral slate for unknown types so a panel never breaks on missing schema.
  const color = (type) => colors.value[type] ?? '#94a3b8'

  return { colors, color, palette: PALETTE }
}
