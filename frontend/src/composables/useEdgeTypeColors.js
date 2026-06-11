// Stable edgeType → color mapping; mirror of useNodeTypeColors but on the edge
// side. Tableau10 + Set3 = ~22 distinct hues, enough for MC1's 12 edge types.
//
// Effective-type aware: when /effective-types/ exposes per-edge labels, the
// type list comes from there; otherwise falls back to `schema.edge_types`.
import { computed, toValue } from 'vue'
import * as d3 from 'd3'
import { injectEffectiveTypes } from './useEffectiveTypes.js'
import { FALLBACK_COLOR } from '@/panels/shared.js'

// 22 saturated, well-separated hues. The yellows and washed-out pastels of the
// old Tableau10+Set3 mix read poorly on white, so the extension uses stronger,
// distinct tones (no near-white yellow).
const PALETTE = [
  // Tableau10 minus its weak yellow (#edc949 dropped)
  '#4e79a7', '#f28e2c', '#e15759', '#76b7b2', '#59a14f',
  '#af7aa1', '#ff9da7', '#9c755f', '#b07aa1', '#499894',
  // Saturated extension
  '#d37295', '#86bcb6', '#a14e9c', '#e6842a', '#6b4c9a',
  '#3a7d44', '#c4622d', '#5878a3', '#b5482e', '#7b6888',
  '#2f9e8f', '#9d5fa8',
]

export function useEdgeTypeColors(schemaRef) {
  const { data: effData } = injectEffectiveTypes()

  const types = computed(() => {
    const labels = effData.value?.edge
    if (Array.isArray(labels) && labels.length) {
      const seen = new Set()
      for (const l of labels) seen.add(l)
      return [...seen].sort()
    }
    return toValue(schemaRef)?.edge_types ?? []
  })

  // Neutral slate fallback so panels never break on missing schema.
  // Fallback color is also used for type == 'Unknown'
  const colorScale = computed(() =>
  d3.scaleOrdinal()
      .domain(types.value.filter(t => t !== 'Unknown'))
      .range(PALETTE)
      .unknown(FALLBACK_COLOR)
  )
  const color = (type) => colorScale.value(type)


  return { color, palette: PALETTE, types }
}
