<script setup>
import { ref, computed, toRef, watch } from 'vue'
import { storeToRefs } from 'pinia'
import * as d3 from 'd3'
import { X, Plus, Undo2 } from 'lucide-vue-next'
import NodeSearchInput from '@/components/NodeSearchInput.vue'
import { injectGraphNodes } from '@/composables/useGraphNodes.js'
import { useEgoSubgraph } from '@/composables/useEgoSubgraph.js'
import { useEffectiveType } from '@/composables/useEffectiveType.js'
import { useNodeTypeColors } from '@/composables/useNodeTypeColors.js'
import { usePanelContextFromProps } from '@/composables/usePanelContext.js'
import { useSelectionStore, MAX_LAYERS } from '@/stores/selection.js'
import { useForceGraph } from '@/composables/useForceGraph.js'
import { usePanel } from './usePanel.js'
import { fromEgoPayload, mergeLayers, filterIntersection } from './layeredGraph.js'
import { makeTooltip, showTip, hideTip, LAYER_PALETTE } from './shared.js'
import ControlSection from './controls/ControlSection.vue'
import ControlSwitch from './controls/ControlSwitch.vue'
import ControlToggleGroup from './controls/ControlToggleGroup.vue'
import SliderControl from './controls/SliderControl.vue'

const props = defineProps({
  panelSpec: { type: Object, required: true },
  schema: { type: Object, default: null },
  graphId: { type: String, default: null },
  widened: { type: Boolean, default: false },
  expanded: { type: Boolean, default: false },
  controlsTarget: { type: String, default: null },
  theoryTarget: { type: String, default: null },
})

defineEmits(['request-widen', 'request-shrink'])

const { controls, updateControl } = usePanel(props, 'ego_compare')
const { data: allNodes } = injectGraphNodes(toRef(props, 'graphId'))
const { nodeType: effNodeType, nodeTypeList } = useEffectiveType(toRef(props, 'graphId'), toRef(props, 'schema'))
const { color: typeColor } = useNodeTypeColors(toRef(props, 'schema'))
const { activeNodeMask, activeEdgeMask, isActive: isActiveId, isEdgeActive } = usePanelContextFromProps(props)

// Selection store is unbounded; crop to MAX_LAYERS — pie encoding breaks above 4.
const selection = useSelectionStore()
const { ids: selectionIds } = storeToRefs(selection)
const egos = computed(() => selectionIds.value.slice(0, MAX_LAYERS))
const canAddMore = computed(() => egos.value.length < MAX_LAYERS)

function addEgo(id) {
  const sid = String(id)
  if (selectionIds.value.includes(sid)) return
  selection.add(sid)
}
function removeEgo(idx) {
  const sid = egos.value[idx]
  if (sid) selection.remove(sid)
}
// Undo the last added ego (selection.add appends, so the tail is the newest).
function undoLast() {
  const last = egos.value[egos.value.length - 1]
  if (last) selection.remove(last)
}

const isDirected = computed(() => !!props.schema?.directed)
const DIRECTION_OPTIONS = [
  { k: 'out', label: 'Out' },
  { k: 'in', label: 'In' },
  { k: 'both', label: 'Both' },
]

// Inline theory-link classes (global Tailwind, not scoped — the block is
// teleported out of this component's tree). Mirrors ConnectedComponents.
const THEORY_LINK = 'underline underline-offset-2 font-medium text-sky-700 hover:text-sky-900 cursor-pointer'
const THEORY_LINK_ON = 'no-underline font-medium text-sky-700 bg-sky-100 rounded px-1 cursor-pointer'
function theoryLinkClass(on) { return on ? THEORY_LINK_ON : THEORY_LINK }
function theorySetControl(field, value) { updateControl(field, value) }

// Summary numbers for the contextual theory text.
const theoryStats = computed(() => {
  const n = egos.value.length
  if (n < 2) return null
  let all = 0, anyPair = 0
  for (const node of merged.value.nodes) {
    if (node.isEgoOf?.size > 0) continue
    if (node.layers.size === n) all++
    if (node.layers.size >= 2) anyPair++
  }
  return { n, all, anyPair }
})
// Venn layout is only meaningful in the intersection view (common nodes only)
// with ≥2 egos — the surviving nodes are shared, so we arrange them by WHICH
// egos share them (center = all, edges = pairs) with egos pinned to vertices.
// `vennAvailable` = the Venn is actually rendering (intersection + ≥2 egos).
// `vennClickable` = the Venn button can be pressed: it only needs ≥2 egos, and
// picking it auto-switches to the intersection view (see setLayout) — so the
// user is never stuck looking at a greyed button with no way to enable it.
// Venn is meaningful only in the intersection view with ≥2 egos. (k is fixed at
// 1 for this whole panel — see the fetch below — so it's not a condition here.)
const vennAvailable = computed(() => !controls.value.showNonCommon && egos.value.length >= 2)
const vennClickable = computed(() => egos.value.length >= 2)
const LAYOUT_OPTIONS = computed(() => [
  { k: 'force', label: 'Force' },
  {
    k: 'venn',
    label: 'Venn',
    disabled: !vennClickable.value,
    title: vennClickable.value
      ? 'Pin egos to a polygon by shared membership (switches to the intersection view)'
      : 'Pick at least 2 egos',
  },
])

// Selecting Venn forces the intersection view (the only one where it makes
// sense); selecting Force leaves the view untouched.
function setLayout(value) {
  if (value === 'venn' && controls.value.showNonCommon) updateControl('showNonCommon', false)
  updateControl('layout', value)
}

// Type accentuation: orthogonal to the per-layer pie coloring — it only drives
// opacity, so the layer-membership encoding stays intact.
const highlightSet = computed(() => new Set(controls.value.highlightTypes ?? []))
function toggleHighlightType(t) {
  const cur = controls.value.highlightTypes ?? []
  const next = cur.includes(t) ? cur.filter(x => x !== t) : [...cur, t]
  updateControl('highlightTypes', next)
}

// Four fixed slots — composables can't be conditionally instantiated. Empty slot → null data.
// k is fixed at 1: at k≥2 an ego's neighborhood would reach (and swallow) the
// other egos and their own neighborhoods, so "overlap" would become an artifact
// of the construction rather than a real shared-neighbor relationship.
const k = computed(() => 1)
const cap = computed(() => controls.value.cap)
const direction = computed(() => controls.value.direction)
const slot0 = computed(() => egos.value[0] ?? null)
const slot1 = computed(() => egos.value[1] ?? null)
const slot2 = computed(() => egos.value[2] ?? null)
const slot3 = computed(() => egos.value[3] ?? null)
const e0 = useEgoSubgraph(slot0, k, cap, toRef(props, 'graphId'), direction)
const e1 = useEgoSubgraph(slot1, k, cap, toRef(props, 'graphId'), direction)
const e2 = useEgoSubgraph(slot2, k, cap, toRef(props, 'graphId'), direction)
const e3 = useEgoSubgraph(slot3, k, cap, toRef(props, 'graphId'), direction)
const slots = [e0, e1, e2, e3]
const anyLoading = computed(() => slots.some(s => s.loading.value))
const anyError = computed(() => slots.find(s => s.error.value)?.error.value || null)

// fromEgoPayload tags nodes/edges with layer i; mergeLayers unions; intersection is a filter on top.
const merged = computed(() =>
  mergeLayers(egos.value.map((_, i) => fromEgoPayload(slots[i].data.value, i)))
)
const filtered = computed(() => {
  if (controls.value.showNonCommon || egos.value.length < 2) return merged.value
  return filterIntersection(merged.value, 2)
})

const caption = computed(() => {
  const u = merged.value
  if (egos.value.length < 2) return null
  const intersection = u.nodes.filter(n => n.layers.size === egos.value.length).length
  const anyPair = u.nodes.filter(n => n.layers.size >= 2).length
  return `${intersection} node${intersection === 1 ? '' : 's'} in all ${egos.value.length} ego networks · ${anyPair} appear in ≥2`
})

const chartContainer = ref(null)
let tooltip = null

function nodeRadius(n) {
  return n.isEgoOf?.size > 0 ? 7 : 4
}

function tooltipHtml(d) {
  const layerList = [...d.layers].sort((a, b) => a - b)
    .map(li => `<span style="display:inline-block;width:8px;height:8px;background:${LAYER_PALETTE[li]};border-radius:50%;margin-right:2px"></span>${egos.value[li]}`)
    .join('<br/>')
  return `<b>${d.id}</b><br/>${effNodeType(d)}<br/>degree ${d.degree}<br/>in ${d.layers.size} ego${d.layers.size === 1 ? '' : 's'}:<br/>${layerList}`
}

function renderNode(g, d) {
  g.selectAll('*').remove()
  const r = nodeRadius(d)
  const layers = [...d.layers].sort((a, b) => a - b)
  // Egos stay full opacity; non-egos dim under the global filter OR when a
  // type-accentuation set is active and this node's type isn't in it.
  const hl = highlightSet.value
  const dimmedByHighlight = hl.size > 0 && !hl.has(effNodeType(d))
  const opacity = d.isEgoOf?.size > 0 ? 1 : (isActiveId(d.id) && !dimmedByHighlight ? 1 : 0.2)
  if (layers.length === 1) {
    g.append('circle').attr('r', r).attr('fill', LAYER_PALETTE[layers[0]]).attr('fill-opacity', opacity)
  } else {
    const arc = d3.arc().innerRadius(0).outerRadius(r)
    const step = (Math.PI * 2) / layers.length
    layers.forEach((li, i) => {
      g.append('path')
        .attr('d', arc({ startAngle: i * step, endAngle: (i + 1) * step }))
        .attr('fill', LAYER_PALETTE[li])
        .attr('fill-opacity', opacity)
    })
  }
  if (d.isEgoOf?.size > 0) {
    g.append('circle').attr('r', r + 1).attr('fill', 'none')
      .attr('stroke', '#000').attr('stroke-width', 1.5)
  }
  if (!tooltip) return
  g.on('mouseover', (e) => showTip(tooltip, e, tooltipHtml(d)))
    .on('mousemove', (e) => showTip(tooltip, e, null))
    .on('mouseout', () => hideTip(tooltip))
}

function renderEdge(sel) {
  sel
    .attr('stroke', d => LAYER_PALETTE[Math.min(...d.layers)])
    .attr('stroke-opacity', d => {
      if (!isEdgeActive(d.edge_id)) return 0.1
      return d.layers.size >= 2 ? 0.85 : 0.45
    })
    .attr('stroke-width', d => d.layers.size >= 2 ? 1.6 : 1)
}

function onNodeClick(d) {
  // Promote non-ego to a new layer (no-op if full).
  if (d.isEgoOf?.size > 0) return
  addEgo(d.id)
}

// --- Venn-polygon layout ---------------------------------------------------
// Egos are pinned to the vertices of a regular polygon (2 → line, 3 → triangle,
// 4 → square). Every other node is pulled toward the centroid of the vertices
// of the egos it belongs to: shared-by-all → center, shared-by-a-pair → that
// edge's midpoint, exclusive → its ego's vertex. The Venn structure (center =
// total intersection, edges = pairwise, tips = exclusive) emerges from forces.
// Only meaningful in the intersection view (common nodes only) with ≥2 egos.
const vennActive = computed(() =>
  controls.value.layout === 'venn' && !controls.value.showNonCommon && egos.value.length >= 2,
)

// Pairwise shared-node counts over the current common nodes: pc[i][j] = number
// of nodes shared by egos i and j (i<j). Drives both the ring order and the
// per-circle radii (data-driven, not a fixed polygon).
const pairCounts = computed(() => {
  const n = egos.value.length
  const pc = Array.from({ length: n }, () => new Array(n).fill(0))
  for (const node of merged.value.nodes) {
    if (node.isEgoOf?.size > 0) continue
    const ls = [...node.layers]
    for (let a = 0; a < ls.length; a++) {
      for (let b = a + 1; b < ls.length; b++) {
        const i = Math.min(ls[a], ls[b]), j = Math.max(ls[a], ls[b])
        pc[i][j]++
      }
    }
  }
  return pc
})

// Per-ego size = number of non-ego alters in each ego network (over the union).
// Drives circle radius (∝ size) so the cap visibly inflates/deflates areas.
const egoSizes = computed(() => {
  const n = egos.value.length
  const sizes = new Array(n).fill(0)
  for (const node of merged.value.nodes) {
    if (node.isEgoOf?.size > 0) continue
    for (const li of node.layers) sizes[li]++
  }
  return sizes
})

// Ring order = the cyclic permutation of layers that maximizes the shared-node
// counts on ADJACENT pairs (so rich pairs sit on edges, poor ones on diagonals
// — where circles can't separate them anyway). 4 sets → not a rigid square:
// the order adapts to the data. Returns an array `pos` where pos[layer] = slot.
function ringOrder(n, pc) {
  if (n <= 3) return Array.from({ length: n }, (_, i) => i) // every pair adjacent
  // n === 4: 3 distinct cyclic orders fixing layer 0 first. Score = sum of
  // adjacent-pair counts around the cycle.
  const candidates = [[0, 1, 2, 3], [0, 1, 3, 2], [0, 2, 1, 3]]
  const score = (order) => {
    let s = 0
    for (let k = 0; k < order.length; k++) {
      const a = order[k], b = order[(k + 1) % order.length]
      s += pc[Math.min(a, b)][Math.max(a, b)]
    }
    return s
  }
  let best = candidates[0], bestScore = -1
  for (const c of candidates) {
    const sc = score(c)
    if (sc > bestScore) { bestScore = sc; best = c }
  }
  // best[slot] = layer → invert to pos[layer] = slot.
  const pos = new Array(n)
  best.forEach((layer, slot) => { pos[layer] = slot })
  return pos
}

// Vertex ring radius (ego center distance from canvas center). `spread` scales
// the whole ring so the user can push the circles apart.
function polyRadius(count, w, h, spread = 1) {
  const base = Math.min(w, h)
  const f = count === 2 ? 0.24 : count === 3 ? 0.26 : 0.30
  return base * f * spread
}

// Per-circle radius. Two contributions, the larger wins:
//   (a) area-proportional: radius ∝ √(ego size) mapped onto [0.7, 1.3]·ringR,
//       so a bigger ego network draws a bigger circle (the cap changes this);
//   (b) overlap floor: must reach the midpoint of each edge to a neighbour it
//       actually shares nodes with, so that pair's lune exists.
// Result scaled by `overlap`.
function circleRadii(sizes, verts, pc, ringR, overlap = 1.12) {
  const n = sizes.length
  const maxSize = Math.max(1, ...sizes)
  const radii = new Array(n)
  for (let i = 0; i < n; i++) {
    // Area ∝ size → radius ∝ √size; map normalized √ onto [0.7, 1.3]·ringR.
    const frac = Math.sqrt(sizes[i] / maxSize) // 0..1
    radii[i] = ringR * (0.7 + 0.6 * frac)
  }
  // Overlap floor for shared pairs.
  for (let i = 0; i < n; i++) {
    for (let j = 0; j < n; j++) {
      if (i === j) continue
      const lo = Math.min(i, j), hi = Math.max(i, j)
      if (pc[lo][hi] <= 0) continue
      const dx = verts[i][0] - verts[j][0]
      const dy = verts[i][1] - verts[j][1]
      const half = Math.hypot(dx, dy) / 2
      radii[i] = Math.max(radii[i], half * overlap)
    }
  }
  return radii
}

// Vertex positions indexed BY LAYER, placed on the ring at their assigned slot.
function vennVertices(count, w, h, pos, spread) {
  const cx = w / 2, cy = h / 2
  const R = polyRadius(count, w, h, spread)
  if (count === 2) {
    // Two egos: left/right (order is irrelevant, every pair is adjacent).
    const slotXY = [[cx - R, cy], [cx + R, cy]]
    return [slotXY[pos[0]], slotXY[pos[1]]]
  }
  const verts = new Array(count)
  for (let layer = 0; layer < count; layer++) {
    const slot = pos[layer]
    const a = -Math.PI / 2 + (slot * 2 * Math.PI) / count
    verts[layer] = [cx + R * Math.cos(a), cy + R * Math.sin(a)]
  }
  return verts
}

// Target point for a node = centroid of the vertices of the egos it belongs to.
function nodeTarget(d, verts) {
  const ls = [...d.layers]
  if (!ls.length) return [verts[0]?.[0] ?? 0, verts[0]?.[1] ?? 0]
  let sx = 0, sy = 0
  for (const li of ls) { sx += verts[li][0]; sy += verts[li][1] }
  return [sx / ls.length, sy / ls.length]
}

// Geometry bundle for the current state (vertices + per-circle radii), shared
// by configureForces and renderBackdrop so they stay consistent.
function vennGeometry(width, height) {
  const count = egos.value.length
  const spread = controls.value.vennSpread ?? 1
  const overlap = controls.value.vennOverlap ?? 1.12
  const pos = ringOrder(count, pairCounts.value)
  const verts = vennVertices(count, width, height, pos, spread)
  const ringR = polyRadius(count, width, height, spread)
  const radii = circleRadii(egoSizes.value, verts, pairCounts.value, ringR, overlap)
  return { verts, radii }
}

function configureForces({ simulation, width, height }) {
  if (!vennActive.value) {
    // Plain centered layout: reinstate centering, release pinned egos.
    simulation
      .force('centerX', d3.forceX(width / 2).strength(0.05))
      .force('centerY', d3.forceY(height / 2).strength(0.05))
    for (const n of simulation.nodes()) {
      if (n.isEgoOf?.size > 0) { n.fx = null; n.fy = null }
    }
    return
  }
  const { verts } = vennGeometry(width, height)
  // Pin each ego to its vertex (layer index = vertex index).
  for (const n of simulation.nodes()) {
    if (n.isEgoOf?.size > 0) {
      const li = [...n.isEgoOf][0]
      const v = verts[li]
      if (v) { n.fx = v[0]; n.fy = v[1] }
    }
  }
  // Non-egos pulled to their layer-centroid; strong enough that the Venn lunes
  // hold against charge/link spread, so shared nodes stay inside the overlap.
  simulation
    .force('centerX', d3.forceX(d => nodeTarget(d, verts)[0]).strength(0.4))
    .force('centerY', d3.forceY(d => nodeTarget(d, verts)[1]).strength(0.4))
}

// Per-ego stats for the circle hover: total alters in this ego, how many are
// shared with ≥1 other ego (with the per-pair breakdown), how many exclusive.
function egoStats(layer) {
  let total = 0, exclusive = 0
  for (const node of merged.value.nodes) {
    if (node.isEgoOf?.size > 0) continue
    if (!node.layers.has(layer)) continue
    total++
    if (node.layers.size === 1) exclusive++
  }
  const shared = total - exclusive
  // Per-pair shared counts involving this layer.
  const pc = pairCounts.value
  const pairs = []
  for (let other = 0; other < egos.value.length; other++) {
    if (other === layer) continue
    const c = pc[Math.min(layer, other)][Math.max(layer, other)]
    if (c > 0) pairs.push({ other, c })
  }
  pairs.sort((a, b) => b.c - a.c)
  return { total, shared, exclusive, pairs }
}

function circleTooltipHtml(layer) {
  const s = egoStats(layer)
  const id = egos.value[layer] ?? ''
  const idShort = id.length > 22 ? id.slice(0, 22) + '…' : id
  const swatch = `<span style="display:inline-block;width:8px;height:8px;background:${LAYER_PALETTE[layer]};border-radius:50%;margin-right:4px"></span>`
  let html = `${swatch}<b>${idShort}</b><br/>`
  html += `${s.total} alter${s.total === 1 ? '' : 's'} · ${s.shared} shared · ${s.exclusive} exclusive`
  if (s.pairs.length) {
    const lines = s.pairs.map(p => {
      const oid = egos.value[p.other] ?? ''
      const oShort = oid.length > 16 ? oid.slice(0, 16) + '…' : oid
      const osw = `<span style="display:inline-block;width:6px;height:6px;background:${LAYER_PALETTE[p.other]};border-radius:50%;margin-right:3px"></span>`
      return `${osw}${p.c} with ${oShort}`
    }).join('<br/>')
    html += `<br/><span style="color:#94a3b8">shared with:</span><br/>${lines}`
  }
  return html
}

// Count, per layer-subset, how many alters are shared by AT LEAST that subset
// (i.e. their layer set ⊇ subset). Keyed by the sorted subset joined with '-'.
function subsetCounts() {
  const counts = new Map()
  for (const node of merged.value.nodes) {
    if (node.isEgoOf?.size > 0) continue
    const ls = [...node.layers].sort((a, b) => a - b)
    // Enumerate every subset of this node's layers with size ≥ 2.
    const m = ls.length
    for (let mask = 0; mask < (1 << m); mask++) {
      if (popcount(mask) < 2) continue
      const sub = []
      for (let b = 0; b < m; b++) if (mask & (1 << b)) sub.push(ls[b])
      const key = sub.join('-')
      counts.set(key, (counts.get(key) || 0) + 1)
    }
  }
  return counts
}

function popcount(x) {
  let c = 0
  while (x) { x &= x - 1; c++ }
  return c
}

// Intersection REGIONS for EVERY ego subset of size ≥2 (pairs, triples, …, all),
// so no combination is ever missing — empty ones are shown too, labelled "0".
// Each region is a base circle clipped in cascade by the others in its subset
// (exact lunes for pairs/triples at ≤3 egos; approximate at 4 — the known limit
// that four circles cannot separate all 16 regions). A point hit-area at the
// subset centroid guarantees the region is hoverable even when its clipped lune
// is geometrically degenerate.
function intersectionRegions(circles) {
  const n = egos.value.length
  if (n < 2) return []
  const counts = subsetCounts()
  const regions = []
  for (let mask = 0; mask < (1 << n); mask++) {
    if (popcount(mask) < 2) continue
    const layers = []
    for (let b = 0; b < n; b++) if (mask & (1 << b)) layers.push(b)
    const key = layers.join('-')
    const cx = layers.reduce((s, li) => s + circles[li].cx, 0) / layers.length
    const cy = layers.reduce((s, li) => s + circles[li].cy, 0) / layers.length
    regions.push({
      key,
      base: layers[0],
      clips: layers.slice(1),
      layers,
      count: counts.get(key) || 0,
      cx, cy,
    })
  }
  return regions
}

function regionTooltipHtml(spot) {
  const swatches = spot.layers.map(li => {
    const id = egos.value[li] ?? ''
    const sw = `<span style="display:inline-block;width:8px;height:8px;background:${LAYER_PALETTE[li]};border-radius:50%;margin-right:3px"></span>`
    return `${sw}${id.length > 16 ? id.slice(0, 16) + '…' : id}`
  }).join('<br/>')
  const k = spot.layers.length
  const title = k === egos.value.length ? 'common to all egos'
    : k === 2 ? 'shared by the pair' : `shared by these ${k}`
  return `<b>${spot.count}</b> node${spot.count === 1 ? '' : 's'} — ${title}<br/>${swatches}`
}

// Venn circles drawn behind the graph: one per ego, centered on its vertex,
// large enough to overlap so shared nodes fall inside the lunes.
function renderBackdrop({ backdrop, width, height }) {
  let circles = []
  let regions = []
  if (vennActive.value) {
    const { verts, radii } = vennGeometry(width, height)
    circles = verts.map((v, i) => ({ cx: v[0], cy: v[1], r: radii[i], layer: i }))
    regions = intersectionRegions(circles)
  }
  const sel = backdrop.selectAll('circle.venn').data(circles, d => d.layer)
  sel.exit().remove()
  const enter = sel.enter().append('circle').attr('class', 'venn')
    .attr('pointer-events', 'all')
    .style('cursor', 'help')
  enter.merge(sel)
    .attr('cx', d => d.cx).attr('cy', d => d.cy).attr('r', d => d.r)
    .attr('fill', d => LAYER_PALETTE[d.layer])
    .attr('fill-opacity', 0.07)
    .attr('stroke', d => LAYER_PALETTE[d.layer])
    .attr('stroke-opacity', 0.45)
    .attr('stroke-width', 1.5)
    .on('mouseover', (e, d) => tooltip && showTip(tooltip, e, circleTooltipHtml(d.layer)))
    .on('mousemove', (e) => tooltip && showTip(tooltip, e, null))
    .on('mouseout', () => tooltip && hideTip(tooltip))
  // Ego label near each vertex, slightly outward, in the layer color.
  const labels = backdrop.selectAll('text.venn-label').data(circles, d => d.layer)
  labels.exit().remove()
  labels.enter().append('text').attr('class', 'venn-label')
    .merge(labels)
    .attr('x', d => d.cx).attr('y', d => d.cy - d.r - 4)
    .attr('text-anchor', 'middle')
    .attr('font-size', 10).attr('font-weight', 600)
    .attr('fill', d => LAYER_PALETTE[d.layer])
    .text(d => {
      const id = egos.value[d.layer] ?? ''
      return id.length > 16 ? id.slice(0, 16) + '…' : id
    })

  // clipPath defs: one circle clip per layer (reused by every region that
  // clips against that layer). userSpaceOnUse → same world coords as the marks.
  let defs = backdrop.select('defs.venn-clips')
  if (defs.empty()) defs = backdrop.append('defs').attr('class', 'venn-clips')
  const clipSel = defs.selectAll('clipPath').data(circles, d => d.layer)
  clipSel.exit().remove()
  const clipEnter = clipSel.enter().append('clipPath')
    .attr('id', d => `venn-clip-${d.layer}`)
  clipEnter.append('circle')
  clipEnter.merge(clipSel).select('circle')
    .attr('cx', d => d.cx).attr('cy', d => d.cy).attr('r', d => d.r)

  // Intersection regions: the base circle, wrapped in one <g clip-path> per
  // other member, so nested clips intersect down to the true overlap lune.
  // Rebuilt from scratch each call (cheap: ≤7 regions) to keep nesting simple.
  backdrop.selectAll('g.region').remove()
  for (const reg of regions) {
    let host = backdrop.append('g').attr('class', 'region').style('cursor', 'help')
    // Nest a clipped <g> for each clip layer.
    let inner = host
    for (const cl of reg.clips) {
      inner = inner.append('g').attr('clip-path', `url(#venn-clip-${cl})`)
    }
    const base = circles[reg.base]
    inner.append('circle')
      .attr('cx', base.cx).attr('cy', base.cy).attr('r', base.r)
      .attr('fill', '#475569').attr('fill-opacity', 0.001)
      .attr('pointer-events', 'all')
      .on('mouseover', (e) => tooltip && showTip(tooltip, e, regionTooltipHtml(reg)))
      .on('mousemove', (e) => tooltip && showTip(tooltip, e, null))
      .on('mouseout', () => tooltip && hideTip(tooltip))

    // Point hit-area at the subset centroid: guarantees the region is always
    // hoverable (and labelled, even "0") even when its clipped lune is degenerate
    // — e.g. triples at 4 egos where circles can't form a real overlap area.
    host.append('circle')
      .attr('cx', reg.cx).attr('cy', reg.cy).attr('r', 13)
      .attr('fill', '#475569').attr('fill-opacity', 0.001)
      .attr('pointer-events', 'all')
      .on('mouseover', (e) => tooltip && showTip(tooltip, e, regionTooltipHtml(reg)))
      .on('mousemove', (e) => tooltip && showTip(tooltip, e, null))
      .on('mouseout', () => tooltip && hideTip(tooltip))
    // Faint marker so empty/degenerate regions are still discoverable.
    if (reg.layers.length >= 3) {
      host.append('circle')
        .attr('cx', reg.cx).attr('cy', reg.cy).attr('r', 3)
        .attr('fill', 'none').attr('stroke', '#64748b')
        .attr('stroke-width', 1).attr('stroke-opacity', 0.4)
        .attr('pointer-events', 'none')
    }
  }
}

const { reconcile, applyForces } = useForceGraph({
  containerRef: chartContainer,
  graphRef: filtered,
  linkDistance: () => controls.value.linkDistance,
  chargeStrength: () => controls.value.chargeStrength,
  renderNode,
  renderEdge,
  getRadius: nodeRadius,
  onNodeClick,
  configureForces,
  renderBackdrop,
  spanFlags: () => [props.widened, props.expanded],
})

watch(
  [activeNodeMask, activeEdgeMask, () => controls.value.highlightTypes],
  () => reconcile(),
  { deep: true },
)

// Re-anchor forces when the layout mode, view, ego set, or the pairwise shared
// counts change (the latter drives ring order + per-circle radii).
watch(
  [
    () => controls.value.layout, () => controls.value.showNonCommon,
    () => egos.value.length, pairCounts,
    () => controls.value.vennSpread, () => controls.value.vennOverlap,
  ],
  () => applyForces(),
  { deep: true },
)

watch(chartContainer, (el) => {
  if (el && !tooltip) tooltip = makeTooltip(el)
})
</script>

<template>
  <div class="flex flex-col gap-1.5 h-full">
    <Teleport v-if="theoryTarget" :to="`#${theoryTarget}`">
      <div class="flex flex-col gap-4 text-sm leading-relaxed text-secondary">

        <section class="flex flex-col gap-2">
          <h3 class="text-xs font-semibold uppercase tracking-widest text-muted">Reading this view</h3>
          <p>
            Each <strong>ego network</strong> is the neighborhood around one chosen node. Comparing
            several reveals their <strong>overlap</strong>: a node may sit in one neighborhood, in a
            pair, or in all of them. Every ego gets its own hue; a node touched by more than one ego
            is drawn as a <strong>pie</strong> of those hues, so a fully multi-colored node is shared
            by every chosen ego.<template v-if="theoryStats">
              Right now <strong>{{ theoryStats.anyPair }}</strong> node{{ theoryStats.anyPair === 1 ? '' : 's' }}
              appear in ≥2 of the {{ theoryStats.n }} egos, and <strong>{{ theoryStats.all }}</strong>
              {{ theoryStats.all === 1 ? 'is' : 'are' }} common to all of them.</template>
          </p>
          <p>
            Switch the <strong>View</strong> between
            <button :class="theoryLinkClass(controls.showNonCommon)"
              @click="theorySetControl('showNonCommon', true)">union</button>
            (every alter, to see how big each neighborhood is and where the intersection sits inside
            it) and
            <button :class="theoryLinkClass(!controls.showNonCommon)"
              @click="theorySetControl('showNonCommon', false)">intersection</button>
            (only the shared nodes, to judge whether the overlap is dense or a sparse coincidence).
            Up to {{ MAX_LAYERS }} egos — beyond that the multi-hue encoding stops being readable.
          </p>
          <p>
            Each ego network is its <strong>direct neighbors only</strong> (k=1). Going to k=2 would
            let one ego reach and swallow another (and that ego's whole neighborhood), so the "overlap"
            would just reflect that they are within two hops, not a genuine shared-neighbor
            relationship — which is why this panel has no k-hop control.
          </p>
        </section>

        <section class="flex flex-col gap-2">
          <h3 class="text-xs font-semibold uppercase tracking-widest text-muted">The Venn layout</h3>
          <p>
            Switch the
            <button :class="theoryLinkClass(controls.layout === 'force')"
              @click="theorySetControl('layout', 'force')">Force</button>
            layout for a
            <button :class="theoryLinkClass(controls.layout === 'venn' && vennAvailable)"
              :disabled="!vennClickable"
              @click="vennClickable && setLayout('venn')">Venn</button>
            one — picking Venn drops you into the intersection view automatically. Egos are pinned to a
            ring and every shared node is pulled toward the
            <em>centroid of the egos it belongs to</em>: common-to-all to the center, a shared pair to
            that edge. Circles are <strong>area-proportional</strong> — a bigger ego draws a bigger
            circle — so raising the node cap visibly inflates them.
          </p>
          <p v-if="vennAvailable">
            Four egos can't be a rigid square (four circles can't separate all regions), so the ring
            order adapts to put the richest pairs on adjacent edges. Two sliders decouple the geometry:
            <strong>spread</strong> sets how far apart the circles sit, <strong>overlap</strong> how
            deeply they intersect.
          </p>
          <p v-else class="text-[13px] text-muted">
            Enable it with the <strong>intersection</strong> view and at least 2 egos.
          </p>
        </section>

        <section class="flex flex-col gap-2">
          <h3 class="text-xs font-semibold uppercase tracking-widest text-muted">Interacting</h3>
          <p>
            <strong>Hover</strong> a circle for its ego's totals (alters, shared, exclusive, and the
            per-pair breakdown); hover any <strong>overlap region</strong> — pairs, triples, all — for
            the exact count of nodes in that intersection (empty ones report <strong>0</strong>, so no
            combination is ever hidden). <strong>Drag</strong> a node to pin it and untangle the layout;
            <strong>drag the background</strong> to pan and <strong>scroll</strong> to zoom into a dense
            region. Click a non-ego node to promote it to a new ego, or use <strong>Undo</strong> to
            drop the last one added.
          </p>
        </section>

      </div>
    </Teleport>

    <Teleport v-if="controlsTarget" :to="`#${controlsTarget}`">
      <div class="grid grid-cols-2 auto-rows-min gap-1.5">
        <ControlSection title="Add ego" :col-span="2">
          <NodeSearchInput
            :nodes="allNodes || []"
            :exclude="egos"
            :disabled="!canAddMore"
            :placeholder="canAddMore ? 'Search node by id…' : `Max ${MAX_LAYERS} egos`"
            @pick="addEgo"
          />
        </ControlSection>

        <ControlSection title="View" :col-span="2">
          <ControlSwitch
            label="Show non-common nodes"
            :model-value="controls.showNonCommon"
            @update:model-value="updateControl('showNonCommon', $event)"
          />
        </ControlSection>

        <ControlSection title="Layout" :col-span="2">
          <ControlToggleGroup
            :model-value="controls.layout"
            :options="LAYOUT_OPTIONS"
            @update:model-value="setLayout($event)"
          />
          <p v-if="controls.layout === 'venn' && vennAvailable" class="text-[10px] text-muted mt-1 leading-tight">
            Egos pinned to a polygon; nodes shared by all pull to the center, those shared by a pair to that edge.
          </p>
        </ControlSection>

        <SliderControl
          v-if="controls.layout === 'venn' && vennAvailable"
          title="Venn spread"
          :model-value="controls.vennSpread"
          :min="0.6" :max="1.6" :step="0.05"
          @update:model-value="updateControl('vennSpread', $event)"
        />
        <SliderControl
          v-if="controls.layout === 'venn' && vennAvailable"
          title="Venn overlap"
          :model-value="controls.vennOverlap"
          :min="1.0" :max="1.7" :step="0.05"
          @update:model-value="updateControl('vennOverlap', $event)"
        />

        <ControlSection title="Accentuate types" :col-span="2" collapsible :default-open="false">
          <template #actions>
            <button
              v-if="(controls.highlightTypes || []).length"
              class="text-[9px] text-muted hover:text-slate-900 uppercase tracking-wider"
              @click="updateControl('highlightTypes', [])"
            >Clear</button>
          </template>
          <div class="flex flex-wrap gap-1">
            <button
              v-for="t in nodeTypeList" :key="t"
              class="type-chip text-[10px] px-2 py-0.5"
              :class="{ 'type-chip--active': (controls.highlightTypes || []).includes(t) }"
              :style="(controls.highlightTypes || []).includes(t) ? { background: typeColor(t), borderColor: typeColor(t), color: '#fff' } : { borderColor: typeColor(t) }"
              @click="toggleHighlightType(t)"
            >{{ t }}</button>
          </div>
          <p class="text-[10px] text-muted mt-1 leading-tight">
            Dims nodes whose type isn't picked. Pie color still encodes ego membership.
          </p>
        </ControlSection>

        <ControlSection v-if="isDirected" title="Direction">
          <ControlToggleGroup
            :model-value="controls.direction"
            :options="DIRECTION_OPTIONS"
            @update:model-value="updateControl('direction', $event)"
          />
        </ControlSection>

        <SliderControl
          title="Max nodes / ego"
          :model-value="controls.cap"
          :min="50" :max="1000" :step="50"
          :lazy="true"
          @update:model-value="updateControl('cap', $event)"
        />

        <SliderControl
          title="Link distance"
          :model-value="controls.linkDistance"
          :min="10" :max="150" :step="5"
          @update:model-value="updateControl('linkDistance', $event)"
        />

        <SliderControl
          title="Charge strength"
          :model-value="controls.chargeStrength"
          :min="-500" :max="-20" :step="10"
          @update:model-value="updateControl('chargeStrength', $event)"
        />
      </div>
    </Teleport>

    <div v-if="egos.length" class="flex items-center gap-1 px-1 flex-wrap">
      <span class="text-[10px] text-muted uppercase tracking-wider mr-1">Egos</span>
      <button
        class="segmented-pill inline-flex h-5 items-center gap-0.5 px-1.5 text-[10px]"
        title="Undo last added ego"
        @click="undoLast"
      ><Undo2 :size="10" /> Undo</button>
      <span
        v-for="(id, i) in egos" :key="`${id}-${i}`"
        class="type-chip text-[10px] px-2 py-0.5 inline-flex items-center gap-1"
        :style="{ borderColor: LAYER_PALETTE[i], color: LAYER_PALETTE[i] }"
      >
        <span class="inline-block w-2 h-2 rounded-full" :style="{ background: LAYER_PALETTE[i] }"></span>
        <span>{{ id.length > 14 ? id.slice(0, 14) + '…' : id }}</span>
        <button class="hover:text-red-500" @click="removeEgo(i)"><X :size="10" /></button>
      </span>
      <span v-if="canAddMore" class="text-[10px] text-muted inline-flex items-center gap-0.5">
        <Plus :size="10" /> add up to {{ MAX_LAYERS - egos.length }} more in the drawer
      </span>
    </div>

    <div
      v-if="!egos.length"
      class="flex flex-1 flex-col items-center justify-center gap-2 surface-recessed rounded-lg p-4 text-sm text-secondary"
    >
      <p class="text-center">Add 2–4 nodes from the drawer to compare their ego networks.</p>
    </div>

    <template v-else>
      <div
        v-if="anyError"
        class="surface-recessed rounded-lg p-3 border border-red-200 text-sm text-red-600"
      >
        <p>{{ anyError }}</p>
        <p class="text-[11px] text-muted">Reduce k-hop or remove the offending ego.</p>
      </div>
      <div
        v-else-if="anyLoading && !filtered.nodes.length"
        class="text-sm text-secondary p-3 surface-recessed rounded-lg"
      >Loading ego subgraphs…</div>

      <div
        ref="chartContainer"
        class="chart-elev w-full relative"
        :class="{ 'hidden': anyError || (anyLoading && !filtered.nodes.length) }"
        style="aspect-ratio: 4/3;"
      ></div>
      <div v-if="caption && !anyError" class="px-1 text-[10px] text-muted leading-tight">
        {{ caption }}
      </div>
      <p v-if="egos.length" class="text-[10px] leading-tight text-muted px-1">
        {{ controls.cap }} alters max per ego, direction <strong>{{ controls.direction }}</strong>. Open settings to raise the cap{{ isDirected ? ' or change direction' : '' }}. Drag nodes to untangle the layout. Filter attenuates non-ego nodes outside it.
      </p>
    </template>
  </div>
</template>
