// Stable nodeType → color mapping; deterministic per graph since the effective
// type list (auto-promoted or raw) is sorted lexicographically client-side.
//
// When auto_promoted.node is active (e.g. Karate's `club`), the type list is
// the unique effective labels ('Mr. Hi', 'Officer') instead of the raw
// `Node Type` (which would degenerate to a single `Unknown`). Falls back to
// `schema.node_types` when no effective list is available.
//
// Shape encoding (redundant channel for high-cardinality types): `shapesFor`
// assigns shapes dynamically within an *active subset* of types. Default is
// circle; a shape disambiguates only when two types in the active set share
// the same color (e.g. after the global palette wraps past 10). Color stays
// static and cross-panel-consistent; shape is local to the active set and may
// differ from panel to panel.
import { computed, toValue } from 'vue'
import * as d3 from 'd3'
import { injectEffectiveTypes } from './useEffectiveTypes.js'

// Tableau10 — d3's canonical 10-color categorical palette. Single source of
// truth (no hardcoded duplication of the hex literals).
const PALETTE = d3.schemeTableau10

// Ordered by perceptual distance from the circle default — the next shape
// picked after a collision is the one most visually different from circle.
const SHAPE_NAMES = ['circle', 'square', 'triangle', 'diamond', 'cross']

const D3_SYMBOL_TYPE = {
  circle: d3.symbolCircle,
  square: d3.symbolSquare,
  triangle: d3.symbolTriangle,
  diamond: d3.symbolDiamond,
  cross: d3.symbolCross,
}

// Two independent encoding channels per base color: 5 shapes × 2 tonalities
// = 10 unique slots per base color, 100 total combinations across Tableau10.
// Slot allocation order: fill all 5 shapes on the base tonality first, then
// the 5 shapes on the brighter variant. Past 10 collisions per base color we
// cycle (rare on real data — would need >100 types of the same base hue).
const TONE_BRIGHTER_DELTA = 0.8

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

  // Falls back to neutral slate so panels never break on missing schema.
  // Fallback color is also used for type == 'Unknown'
  const color = d3.scaleOrdinal()
    .domain(types.value.filter(t => t !== 'Unknown'))
    .range(PALETTE)
    .unknown('#94a3b8')

  // Allocate `{shape, color}` for each type in `activeTypes` so that within the
  // set no two types share both shape AND color tonality. Process in order; for
  // each type, the first free slot for its base color wins.
  //
  // Slot mapping (0..9 per base color):
  //   shape = SHAPE_NAMES[slot % 5]
  //   tone  = Math.floor(slot / 5)   // 0 = base, 1 = brighter variant
  function stylesFor(activeTypes) {
    const usedByColor = new Map()
    const out = {}
    for (const t of activeTypes) {
      const baseColor = color(t)
      const used = usedByColor.get(baseColor) ?? new Set()
      let slot = 0
      while (used.has(slot) && slot < 10) slot++
      if (slot >= 10) slot = used.size % 10
      used.add(slot)
      usedByColor.set(baseColor, used)
      const shape = SHAPE_NAMES[slot % 5]
      const tone = Math.floor(slot / 5)
      const tColor = tone === 0
        ? baseColor
        : (d3.color(baseColor)?.brighter(TONE_BRIGHTER_DELTA).formatHex() ?? baseColor)
      out[t] = { shape, color: tColor }
    }
    return out
  }

  // Resolve a shape name to a d3 symbol type (for `d3.symbol().type(…)`).
  function d3SymbolType(shape) {
    return D3_SYMBOL_TYPE[shape] ?? D3_SYMBOL_TYPE.circle
  }

  // Return a self-contained SVG path string for a shape at a given area (px²).
  // Handy for template glyphs (chips, legend swatches).
  function symbolPath(shape, area = 25) {
    return d3.symbol().type(d3SymbolType(shape)).size(area)()
  }

  return {
    color, palette: PALETTE, types,
    stylesFor, d3SymbolType, symbolPath,
    SHAPE_NAMES,
  }
}
