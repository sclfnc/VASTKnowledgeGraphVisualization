<script setup>
import { ref, computed, toRef, watch, nextTick } from 'vue'
import * as d3 from 'd3'
import { Spline } from 'lucide-vue-next'
import { useEdgeFlow } from '@/composables/useEdgeFlow.js'
import { injectGraphNodes } from '@/composables/useGraphNodes.js'
import { injectGraphEdges } from '@/composables/useGraphEdges.js'
import { useNodeTypeColors } from '@/composables/useNodeTypeColors.js'
import { useEdgeTypeColors } from '@/composables/useEdgeTypeColors.js'
import { useEffectiveType } from '@/composables/useEffectiveType.js'
import { usePanelContextFromProps } from '@/composables/usePanelContext.js'
import { useSelectionStore } from '@/stores/selection.js'
import { usePanel } from './usePanel.js'
import { useD3Chart } from './useD3Chart.js'
import { makeTooltip, showTip, hideTip, selectedTypesIn, idsOfTypesSoA } from './shared.js'
import ControlSection from './controls/ControlSection.vue'
import ControlSwitch from './controls/ControlSwitch.vue'

const props = defineProps({
  panelSpec: { type: Object, required: true },
  schema: { type: Object, default: null },
  graphId: { type: String, default: null },
  widened: { type: Boolean, default: false },
  expanded: { type: Boolean, default: false },
  controlsTarget: { type: String, default: null },
  theoryTarget: { type: String, default: null },
})

const THEORY_LINK = 'underline underline-offset-2 font-medium text-sky-700 hover:text-sky-900 cursor-pointer'
const THEORY_LINK_ON = 'no-underline font-medium text-sky-700 bg-sky-100 rounded px-1 cursor-pointer'
function theoryLinkClass(on) { return on ? THEORY_LINK_ON : THEORY_LINK }

const emit = defineEmits(['request-widen', 'request-shrink'])

const { data, loading, error } = useEdgeFlow(toRef(props, 'graphId'))
const { nodes: nodesSoA } = injectGraphNodes(toRef(props, 'graphId'))
const { edges: edgesSoA } = injectGraphEdges(toRef(props, 'graphId'))
const { color: typeColor } = useNodeTypeColors(toRef(props, 'schema'))
const { nodeTypeAt, nodeTypeList } = useEffectiveType(toRef(props, 'graphId'), toRef(props, 'schema'))
const { activeEdgeMask, selectedMask, edgeFilterActive, noNodesActive } = usePanelContextFromProps(props)
const selection = useSelectionStore()

// Effective node types with ≥1 node in the selection — used to outline the
// meta-node and the arcs that touch a selected type. Cap-safe. Same helper as TypeMixing.
const selectedNodeTypes = computed(() =>
  selectedTypesIn(nodesSoA.value?.N ?? 0, selectedMask.value, nodeTypeAt))
const { controls, updateControl } = usePanel(props, 'edge_flow', data)

// Always recompute flows from edges SoA + activeEdgeMask: single codepath,
// edge filters (type/weight/selfLoop) propagate uniformly.
// Nested Map keyed by tuple-of-Maps avoids string-split fragility on type
// names with separator-like characters.
const liveFlows = computed(() => {
  const soaN = nodesSoA.value
  const soaE = edgesSoA.value
  const eMask = activeEdgeMask.value
  if (!soaN || !soaE || !eMask) return []
  const directed = data.value?.directed ?? false
  const acc = new Map()  // Map<st, Map<et, Map<dt, count>>>
  for (let i = 0; i < soaE.E; i++) {
    if (!eMask.get(i)) continue
    let st = nodeTypeAt(soaE.source[i])
    let dt = nodeTypeAt(soaE.target[i])
    if (!directed && st > dt) { const tmp = st; st = dt; dt = tmp }
    const et = soaE.edgeTypes[soaE.type[i]]
    let byEt = acc.get(st)
    if (!byEt) { byEt = new Map(); acc.set(st, byEt) }
    let byDt = byEt.get(et)
    if (!byDt) { byDt = new Map(); byEt.set(et, byDt) }
    byDt.set(dt, (byDt.get(dt) || 0) + 1)
  }
  const out = []
  for (const [src_type, byEt] of acc) {
    for (const [edge_type, byDt] of byEt) {
      for (const [dst_type, count] of byDt) {
        out.push({ src_type, edge_type, dst_type, count })
      }
    }
  }
  out.sort((a, b) => b.count - a.count)
  return out
})

const mainContainer = ref(null)
const tableContainer = ref(null)
let tooltip = null

const MARGINS = { top: 20, right: 20, bottom: 20, left: 20 }

// Shared, effective-type-aware edge palette — same hue per edge type across all panels.
const { color: edgeColor } = useEdgeTypeColors(toRef(props, 'schema'))

// Effective node-type list (auto-promotion aware).
const allNodeTypes = computed(() =>
  nodeTypeList.value.length ? nodeTypeList.value : (data.value?.node_types ?? []))

// SINGLE filter axis. Edge Type Flow is about relationships, so when the graph
// has ≥2 edge types we filter by edge type; with one (or none) the per-arc color
// carries no information, so we fall back to filtering by node type. With <2 of
// both the meta-graph is a single circle and the panel isn't shown.
const filterMode = computed(() => {
  if ((data.value?.edge_types?.length || 0) > 1) return 'edge'
  if (allNodeTypes.value.length > 1) return 'node'
  return null
})
const filterUniverse = computed(() =>
  filterMode.value === 'edge' ? (data.value?.edge_types ?? []) : allNodeTypes.value)
const hiddenTypes = computed(() => new Set(controls.value.hiddenTypes || []))

// Flows that survive the single subtractive filter (a type is shown unless you
// hid it) plus the self-loop toggle. One axis → impossible to empty by conflict:
// you only ever remove what you explicitly switch off.
const candidateFlows = computed(() => {
  const hidden = hiddenTypes.value
  const mode = filterMode.value
  let list = liveFlows.value
  if (controls.value.hideSelfLoops) list = list.filter(f => f.src_type !== f.dst_type)
  if (hidden.size) {
    if (mode === 'edge') list = list.filter(f => !hidden.has(f.edge_type))
    else list = list.filter(f => !hidden.has(f.src_type) && !hidden.has(f.dst_type))
  }
  return list
})

// All candidate flows are shown — no Top-N cap. Kept as a named alias so the
// many call sites below read clearly ("the flows on screen").
const filteredFlows = candidateFlows

// Nodes + edges actually touched by the VISIBLE flows. A second pass over the
// edges SoA keeps only edges whose (src_type, edge_type, dst_type) triple
// survived every refiner + the Top-N cap, then collects the distinct node
// indices per type and the edge count. This makes the meta-node sizes and the
// caption react live: a type with no visible edge disappears entirely.
const visibleStats = computed(() => {
  const soaE = edgesSoA.value
  const eMask = activeEdgeMask.value
  const empty = { nodesByType: new Map(), edgeCount: 0, nodeCount: 0 }
  if (!soaE || !eMask) return empty
  const directed = data.value?.directed ?? false
  // Allowed triples from the visible flows (undirected flows were normalized
  // st≤dt in liveFlows, so match the same orientation here).
  const allowed = new Set()
  for (const f of candidateFlows.value) allowed.add(`${f.src_type} ${f.edge_type} ${f.dst_type}`)
  if (!allowed.size) return empty

  const nodesByType = new Map()
  const allNodes = new Set()
  let edgeCount = 0
  const touch = (idx) => {
    const t = nodeTypeAt(idx)
    let s = nodesByType.get(t)
    if (!s) { s = new Set(); nodesByType.set(t, s) }
    s.add(idx)
    allNodes.add(idx)
  }
  for (let i = 0; i < soaE.E; i++) {
    if (!eMask.get(i)) continue
    let st = nodeTypeAt(soaE.source[i])
    let dt = nodeTypeAt(soaE.target[i])
    if (!directed && st > dt) { const tmp = st; st = dt; dt = tmp }
    const et = soaE.edgeTypes[soaE.type[i]]
    if (!allowed.has(`${st} ${et} ${dt}`)) continue
    touch(soaE.source[i])
    touch(soaE.target[i])
    edgeCount++
  }
  return { nodesByType, edgeCount, nodeCount: allNodes.size }
})

// Aggregate per (src,dst) so multi-edge-type arcs bundle with perpendicular offset.
const arcBundles = computed(() => {
  const map = new Map()
  for (const f of filteredFlows.value) {
    const key = `${f.src_type}|${f.dst_type}`
    if (!map.has(key)) map.set(key, [])
    map.get(key).push(f)
  }
  return map
})

const totalFlowSum = computed(() => d3.sum(filteredFlows.value, f => f.count))

// Per-effective-type node count, derived from SoA. Backend payload's
// `node_counts` is keyed by raw type and would be wrong under auto-promotion.
const effectiveNodeCounts = computed(() => {
  const soa = nodesSoA.value
  if (!soa) return {}
  const out = {}
  for (let i = 0; i < soa.N; i++) {
    const t = nodeTypeAt(i)
    out[t] = (out[t] || 0) + 1
  }
  return out
})

// Total flow volume per type (src + dst), over the visible flows. Drives the
// circle ordering so the most-connected types sit next to each other and the
// long chords that cross the disk are minimized.
const typeVolume = computed(() => {
  const m = new Map()
  for (const f of filteredFlows.value) {
    m.set(f.src_type, (m.get(f.src_type) || 0) + f.count)
    m.set(f.dst_type, (m.get(f.dst_type) || 0) + f.count)
  }
  return m
})

const visibleTypes = computed(() => {
  // Only types actually touched by a visible edge (from visibleStats); a type
  // with no live edge disappears. Type list uses effective labels.
  const touched = visibleStats.value.nodesByType
  const all = nodeTypeList.value.length ? nodeTypeList.value : (data.value?.node_types ?? [])
  const list = all.filter(t => (touched.get(t)?.size || 0) > 0)
  // Order by volume desc so heavy types cluster; ties keep stable list order.
  const vol = typeVolume.value
  return [...list].sort((a, b) => (vol.get(b) || 0) - (vol.get(a) || 0))
})

function isDirected() { return !!data.value?.directed }

// Filter chips: two states only. Filled = shown, faded = you hid it. Coloring
// tracks YOUR hide choices (not "what's present"), so the click is always
// predictable — click a filled chip to hide it, a faded one to bring it back.
// The graph and the live counts adapt on their own.
function toggleType(t) {
  const cur = controls.value.hiddenTypes || []
  updateControl('hiddenTypes', cur.includes(t) ? cur.filter(x => x !== t) : [...cur, t])
}
function clearHidden() { updateControl('hiddenTypes', []) }
function hideAll() { updateControl('hiddenTypes', [...filterUniverse.value]) }
const anyHidden = computed(() => (controls.value.hiddenTypes || []).length > 0)
const allHidden = computed(() => hiddenTypes.value.size >= filterUniverse.value.length && filterUniverse.value.length > 0)
const filterColor = (t) => (filterMode.value === 'edge' ? edgeColor(t) : typeColor(t))

// Arc direction gradient: deep/saturated at the SOURCE end → lighter, softer
// shade of the SAME hue at the TARGET. Used by the arcs and by the legend key.
function arcShades(hex) {
  const c = d3.hsl(hex)
  const src = d3.hsl(c.h, Math.min(1, c.s * 1.05), Math.max(0, c.l * 0.82))
  const dst = d3.hsl(c.h, Math.max(0, c.s * 0.55), Math.min(0.92, c.l * 1.28 + 0.1))
  return { src: src.formatHex(), dst: dst.formatHex() }
}
// Direction-encoding key, demoed on a neutral slate. Directed graphs only.
const dirKey = computed(() => arcShades('#64748b'))
function chipStyle(shown, color) {
  return shown
    ? { background: color, borderColor: color, color: '#fff', opacity: 1 }
    : { borderColor: color, color, opacity: 0.35 }
}

function renderMain() {
  if (!mainContainer.value) return
  d3.select(mainContainer.value).selectAll('*').remove()
  if (!data.value) return

  const totalW = mainContainer.value.clientWidth || 400
  const totalH = mainContainer.value.clientHeight || Math.round(totalW * 3 / 4)
  const innerW = Math.max(50, totalW - MARGINS.left - MARGINS.right)
  const innerH = Math.max(50, totalH - MARGINS.top - MARGINS.bottom)

  const svg = d3.select(mainContainer.value).append('svg')
    .attr('width', totalW).attr('height', totalH)
  // Recreate every render: the selectAll('*').remove() above wipes the previous
  // tooltip div (it lives in this container), so a cached ref would be detached.
  tooltip = makeTooltip(mainContainer.value)

  const types = visibleTypes.value
  if (!types.length) {
    svg.append('text').attr('x', totalW / 2).attr('y', totalH / 2)
      .attr('text-anchor', 'middle').attr('font-size', 12).attr('fill', '#94a3b8')
      .text('No flows match the current filters')
    return
  }

  // Radial layout: meta-nodes on a circle.
  const cx = MARGINS.left + innerW / 2
  const cy = MARGINS.top + innerH / 2
  // Circle size = distinct nodes of that type touched by the visible flows
  // (dynamic): a type with no live edge isn't in `types` at all.
  const touchedByType = visibleStats.value.nodesByType
  const nodeCounts = {}
  for (const t of types) nodeCounts[t] = touchedByType.get(t)?.size || 0
  const maxCount = d3.max(types, t => nodeCounts[t] || 0) || 1
  const minCount = d3.min(types, t => nodeCounts[t] || 0) || 0
  const half = Math.min(innerW, innerH) / 2
  const n = types.length
  // First place the ring, then size the nodes so adjacent circles CANNOT touch.
  // Reserve a fixed-ish band for the largest node + its loop + outside labels.
  const labelBandGuess = 56
  const radius = Math.max(30, half - labelBandGuess)
  // Chord between two adjacent ring positions. The biggest node must be smaller
  // than half that gap (so two neighbours never overlap), minus a breathing gap.
  const chord = n > 1 ? 2 * radius * Math.sin(Math.PI / n) : radius
  const GAP = 10  // min empty space between neighbouring rims
  const maxNodeR = Math.max(10, Math.min(40, chord / 2 - GAP))
  const minNodeR = Math.max(8, maxNodeR * 0.4)
  // Real [min,max] span of the visible counts so the perceptual range isn't
  // wasted anchoring at 0 (sqrt for area-true comparison).
  const sizeScale = d3.scaleSqrt()
    .domain(minCount === maxCount ? [0, maxCount] : [minCount, maxCount])
    .range(minCount === maxCount ? [maxNodeR, maxNodeR] : [minNodeR, maxNodeR])
  const biggestR = maxNodeR
  const fitsInside = (r, label) => (2 * r) >= (label.length * 6.2 + 8)
  const LOOP_BULGE = 22

  const nodePos = new Map()
  types.forEach((t, i) => {
    const angle = (i / types.length) * 2 * Math.PI - Math.PI / 2
    nodePos.set(t, {
      type: t,
      x: cx + radius * Math.cos(angle),
      y: cy + radius * Math.sin(angle),
      r: sizeScale(nodeCounts[t] || 0),
    })
  })

  const defs = svg.append('defs')
  // Soft drop-shadow for the meta-nodes — lifts them off the arc layer.
  const shadow = defs.append('filter').attr('id', 'ef-node-shadow')
    .attr('x', '-40%').attr('y', '-40%').attr('width', '180%').attr('height', '180%')
  shadow.append('feDropShadow')
    .attr('dx', 0).attr('dy', 1).attr('stdDeviation', 1.5)
    .attr('flood-color', '#0f172a').attr('flood-opacity', 0.18)

  const arcsG = svg.append('g').attr('class', 'arcs')
  const selTypes = selectedNodeTypes.value
  const anySelected = selTypes.size > 0

  const widthDomainMax = d3.max(filteredFlows.value, f => f.count) || 1
  // Line thickness ∝ √count, capped so the heaviest flow never dwarfs the nodes.
  const maxStroke = Math.max(1.5, Math.min(9, biggestR * 0.45))
  const widthScale = d3.scaleSqrt().domain([0, widthDomainMax]).range([0.8, maxStroke])

  // Direction is encoded by a color GRADIENT along each arc (no arrowheads):
  // deep, saturated color at the SOURCE end → a lighter, slightly desaturated
  // (but still present) shade of the SAME hue at the TARGET. The arc stays
  // visible end-to-end; direction reads from intense→soft. One gradient per arc.
  const directed = isDirected()
  let gradSeq = 0

  for (const [key, arcs] of arcBundles.value.entries()) {
    const [src, dst] = key.split('|')
    const a = nodePos.get(src)
    const b = nodePos.get(dst)
    if (!a || !b) continue
    arcs.forEach((f, idx) => {
      const color = edgeColor(f.edge_type)
      const sw = widthScale(f.count)

      let path
      let srcPt, dstPt  // arc endpoints, for the direction gradient
      if (src === dst) {
        // Self-loop: a curved arc bulging outward along the node's radial direction.
        const ang = Math.atan2(a.y - cy, a.x - cx)
        const loopR = LOOP_BULGE + idx * 7
        const ox = Math.cos(ang), oy = Math.sin(ang)
        srcPt = { x: a.x + a.r * Math.cos(ang - 0.32), y: a.y + a.r * Math.sin(ang - 0.32) }
        dstPt = { x: a.x + a.r * Math.cos(ang + 0.32), y: a.y + a.r * Math.sin(ang + 0.32) }
        const ctrl = { x: a.x + (a.r + loopR) * ox, y: a.y + (a.r + loopR) * oy }
        path = `M${srcPt.x},${srcPt.y} Q${ctrl.x},${ctrl.y} ${dstPt.x},${dstPt.y}`
      } else {
        // Chord bent toward the disk centre, proportionally to its length —
        // long crossings bow inward (light edge-bundling). Siblings fan out.
        const mx = (a.x + b.x) / 2, my = (a.y + b.y) / 2
        const dx = b.x - a.x, dy = b.y - a.y
        const len = Math.hypot(dx, dy) || 1
        const nx = -dy / len, ny = dx / len
        const pull = 0.42 * (len / (2 * radius))
        const bcx = mx + (cx - mx) * pull
        const bcy = my + (cy - my) * pull
        const offset = (idx - (arcs.length - 1) / 2) * (sw + 7)
        const ctrl = { x: bcx + nx * offset, y: bcy + ny * offset }
        // Anchor on the node rims, spread a little along the perimeter so
        // siblings of the same pair leave from distinct points.
        const aBase = Math.atan2(ctrl.y - a.y, ctrl.x - a.x)
        const bBase = Math.atan2(ctrl.y - b.y, ctrl.x - b.x)
        const aSpread = Math.min(0.45, (sw + 2) / a.r) * Math.sign(offset || 1) * (offset ? 0.6 : 0)
        const bSpread = Math.min(0.45, (sw + 2) / b.r) * Math.sign(offset || 1) * (offset ? 0.6 : 0)
        const aAng = aBase + aSpread
        const bAng = bBase + bSpread
        srcPt = { x: a.x + Math.cos(aAng) * (a.r + 1), y: a.y + Math.sin(aAng) * (a.r + 1) }
        dstPt = { x: b.x + Math.cos(bAng) * (b.r + 1), y: b.y + Math.sin(bAng) * (b.r + 1) }
        path = `M${srcPt.x},${srcPt.y} Q${ctrl.x},${ctrl.y} ${dstPt.x},${dstPt.y}`
      }

      const arcSelected = selTypes.has(f.src_type) || selTypes.has(f.dst_type)
      const op = anySelected ? (arcSelected ? 0.95 : 0.12) : 0.72

      // Stroke paint: a source→target hue/intensity gradient on directed graphs
      // (deep at the source, lighter-and-softer at the target), flat otherwise.
      let stroke = color
      if (directed) {
        const { src: cSrc, dst: cDst } = arcShades(color)
        const gid = `ef-grad-${gradSeq++}`
        const grad = defs.append('linearGradient')
          .attr('id', gid).attr('gradientUnits', 'userSpaceOnUse')
          .attr('x1', srcPt.x).attr('y1', srcPt.y)
          .attr('x2', dstPt.x).attr('y2', dstPt.y)
        grad.append('stop').attr('offset', '0%').attr('stop-color', cSrc)
        grad.append('stop').attr('offset', '100%').attr('stop-color', cDst)
        stroke = `url(#${gid})`
      }

      arcsG.append('path')
        .attr('d', path)
        .attr('fill', 'none')
        .attr('stroke', stroke)
        .attr('stroke-width', sw)
        .attr('stroke-linecap', 'round')
        .attr('stroke-opacity', op)
        .style('cursor', 'pointer')
        .on('mouseover', function (ev) { d3.select(this).attr('stroke-opacity', 1); showTip(tooltip, ev, tooltipFlow(f)) })
        .on('mousemove', (ev) => showTip(tooltip, ev, null))
        .on('mouseout', function () { d3.select(this).attr('stroke-opacity', op); hideTip(tooltip) })
        .on('click', () => selectFlow(f))
    })
  }

  // Meta-nodes.
  const nodesG = svg.append('g').attr('class', 'meta-nodes')
  for (const t of types) {
    const p = nodePos.get(t)
    const nodeSelected = selTypes.has(t)
    const dimmed = anySelected && !nodeSelected
    const g = nodesG.append('g')
      .attr('transform', `translate(${p.x},${p.y})`)
      .style('cursor', 'pointer')
      .attr('opacity', dimmed ? 0.35 : 1)
      .on('mouseover', (ev) => showTip(tooltip, ev, tooltipType(t)))
      .on('mousemove', (ev) => showTip(tooltip, ev, null))
      .on('mouseout', () => hideTip(tooltip))
      .on('click', () => selectType(t))
    g.append('circle')
      .attr('r', p.r)
      .attr('fill', typeColor(t))
      .attr('stroke', nodeSelected ? '#0f172a' : '#fff')
      .attr('stroke-width', nodeSelected ? 2 : 0.75)
      .attr('stroke-opacity', nodeSelected ? 1 : 0.7)
      .attr('filter', 'url(#ef-node-shadow)')
    // Label inside only when the word actually fits the diameter; otherwise
    // place it on a radial tangent outside the circle so it is never clipped.
    if (fitsInside(p.r, t)) {
      g.append('text')
        .attr('text-anchor', 'middle').attr('dy', '0.35em')
        .attr('font-size', 11).attr('font-weight', 600).attr('fill', '#fff')
        .attr('pointer-events', 'none').text(t)
    } else {
      const ang = Math.atan2(p.y - cy, p.x - cx)
      const outward = Math.abs(Math.cos(ang)) > 0.3 ? (Math.cos(ang) > 0 ? 'start' : 'end') : 'middle'
      const label = g.append('text')
        .attr('x', Math.cos(ang) * (p.r + 5))
        .attr('y', Math.sin(ang) * (p.r + 5))
        .attr('text-anchor', outward).attr('dy', '0.32em')
        .attr('font-size', 10).attr('font-weight', 600).attr('fill', '#334155')
        .attr('pointer-events', 'none').text(t)
      // White halo so the label stays legible where it overlaps a ribbon.
      label.clone(true).lower()
        .attr('fill', 'none').attr('stroke', '#fff').attr('stroke-width', 3)
        .attr('stroke-linejoin', 'round')
    }
  }

}

function tooltipFlow(f) {
  const pct = totalFlowSum.value ? ((f.count / totalFlowSum.value) * 100).toFixed(1) : '?'
  const arrow = isDirected() ? '→' : '—'
  return `<b>${f.src_type}</b> ${arrow}<i>${f.edge_type}</i>${arrow} <b>${f.dst_type}</b><br>${f.count.toLocaleString()} edges (${pct}% of shown)`
}
function tooltipType(t) {
  const touched = visibleStats.value.nodesByType.get(t)?.size ?? 0
  const total = effectiveNodeCounts.value[t] ?? 0
  // Per-type flow summary over the CURRENT view (filteredFlows).
  let out = 0, inn = 0, self = 0
  const partners = new Set()
  for (const f of filteredFlows.value) {
    if (f.src_type === t && f.dst_type === t) { self += f.count; continue }
    if (f.src_type === t) { out += f.count; partners.add(f.dst_type) }
    if (f.dst_type === t) { inn += f.count; partners.add(f.src_type) }
  }
  const head = `<b>${t}</b><br>${touched.toLocaleString()} of ${total.toLocaleString()} nodes in view`
  const flowLine = isDirected()
    ? `${out.toLocaleString()} out · ${inn.toLocaleString()} in`
    : `${(out + inn).toLocaleString()} edges`
  const selfLine = self ? ` · ${self.toLocaleString()} self` : ''
  return `${head}<br>${flowLine}${selfLine}<br>${partners.size} connected type${partners.size === 1 ? '' : 's'}`
}

// Select every node of the involved type(s) — the store is unbounded by design,
// and an arbitrary cap on a type-level meta-graph made no sense.
function selectFlow(f) {
  selection.replace(idsOfTypesSoA(nodesSoA.value, [f.src_type, f.dst_type], nodeTypeAt))
}
function selectType(t) {
  selection.replace(idsOfTypesSoA(nodesSoA.value, t, nodeTypeAt))
}

// Flows table (drill-down on widen).
function renderTable() {
  if (!tableContainer.value) return
  d3.select(tableContainer.value).selectAll('*').remove()
  if (!props.widened || !data.value) return
  const total = totalFlowSum.value || 1

  const container = d3.select(tableContainer.value)
    .append('div')
    .attr('class', 'flow-table h-full overflow-auto text-[11px]')

  const table = container.append('table').attr('class', 'w-full border-collapse')
  const thead = table.append('thead')
  thead.append('tr').selectAll('th')
    .data(['Source', 'Edge', 'Target', 'Count', '%'])
    .join('th')
    .attr('class', 'px-2 py-1 text-left text-muted font-semibold border-b border-slate-200 sticky top-0 bg-white')
    .text(d => d)

  const tbody = table.append('tbody')
  const rows = tbody.selectAll('tr').data(filteredFlows.value).join('tr')
    .attr('class', 'hover:bg-slate-50 cursor-pointer')
    .on('click', (_, f) => selectFlow(f))

  rows.append('td').attr('class', 'px-2 py-1 border-b border-slate-100').text(f => f.src_type)
  rows.append('td').attr('class', 'px-2 py-1 border-b border-slate-100')
    .append('span')
    .style('color', f => edgeColor(f.edge_type))
    .text(f => f.edge_type)
  rows.append('td').attr('class', 'px-2 py-1 border-b border-slate-100').text(f => f.dst_type)
  rows.append('td').attr('class', 'px-2 py-1 border-b border-slate-100 text-right tabular-nums').text(f => f.count.toLocaleString())
  rows.append('td').attr('class', 'px-2 py-1 border-b border-slate-100 text-right tabular-nums text-muted')
    .text(f => `${((f.count / total) * 100).toFixed(1)}%`)
}

function renderAll() { renderMain(); renderTable() }

// Watch the computeds that actually drive the render (not `controls` deep — a
// computed changes reference on any upstream change, so the redraw always fires).
watch(
  [data, () => props.widened, filteredFlows, visibleStats, visibleTypes, selectedNodeTypes],
  () => nextTick(renderAll),
  { deep: true },
)

useD3Chart([mainContainer, tableContainer], renderAll, () => [props.widened, props.expanded])

function toggleWiden() {
  if (props.widened) emit('request-shrink')
  else emit('request-widen')
}
</script>

<template>
  <div class="flex flex-col gap-1.5">
    <Teleport v-if="theoryTarget" :to="`#${theoryTarget}`">
      <div class="flex flex-col gap-4 text-sm leading-relaxed text-secondary">

        <section class="flex flex-col gap-2">
          <h3 class="text-xs font-semibold uppercase tracking-widest text-muted">Reading this view</h3>
          <p>
            This is a <strong>meta-graph</strong>: every node is collapsed into its <strong>type</strong>,
            so you see the schema's shape — who connects to whom — on one screen instead of thousands of
            dots. Four visual channels carry the data:
          </p>
          <ul class="flex flex-col gap-1.5 pl-1">
            <li class="flex gap-2">
              <span class="mt-1 inline-block w-2.5 h-2.5 rounded-full bg-slate-400 shrink-0" />
              <span><strong>Circle = node type.</strong> Its area (√-scaled, so area is honest) is how
              many nodes of that type are touched by the flows currently in view — filter something out
              and the circles shrink or vanish.</span>
            </li>
            <li class="flex gap-2">
              <span class="mt-1 inline-block w-4 h-1 rounded-full bg-slate-400 shrink-0" />
              <span><strong>Arc = a relationship between two types.</strong> Its <strong>color</strong> is
              the edge type; its <strong>thickness</strong> (√) is how many edges of that type run
              between the two circles it links.</span>
            </li>
            <li v-if="isDirected()" class="flex gap-2">
              <span class="mt-1 inline-block w-4 h-1.5 rounded-full shrink-0"
                :style="{ background: `linear-gradient(to right, ${dirKey.src}, ${dirKey.dst})` }" />
              <span><strong>Fade = direction.</strong> Each arc is deep at the <strong>source</strong>
              end and fades to a light shade of the same hue at the <strong>target</strong> — the solid
              end is where the relationship starts.</span>
            </li>
            <li class="flex gap-2">
              <span class="mt-1 text-slate-400 shrink-0 text-xs">↺</span>
              <span><strong>Loop = self-link.</strong> An arc bulging off a single circle means that
              type connects to itself. You can
              <button :class="theoryLinkClass(controls.hideSelfLoops)"
                @click="updateControl('hideSelfLoops', !controls.hideSelfLoops)">hide self-loops</button>
              to declutter.</span>
            </li>
          </ul>
          <p class="text-[13px] text-muted">
            Hover any circle or arc for a summary of the current view; click one to select its nodes
            across the other panels.
          </p>
        </section>

        <section class="flex flex-col gap-2">
          <h3 class="text-xs font-semibold uppercase tracking-widest text-muted">Why a circle, not a Sankey</h3>
          <p>
            A Sankey forces a left-to-right reading and chokes on cycles — common in knowledge graphs
            (A produces B, B references A). The radial layout handles cycles natively and stays
            compact as the schema grows. Types are ordered around the rim by total flow volume, so the
            busiest types sit together and the long chords that cross the disk are kept to a minimum.
          </p>
        </section>

        <section class="flex flex-col gap-2">
          <h3 class="text-xs font-semibold uppercase tracking-widest text-muted">Focusing</h3>
          <p>
            Arc width is the <strong>edge count</strong> between the two types, so a few heavy
            relationships dominate. One filter declutters the view: when the graph has several
            <strong>edge types</strong> you hide/show them (the per-arc color), otherwise you hide/show
            <strong>node types</strong>. It's subtractive — everything starts visible, click a chip to
            hide it, and the circles and arcs adapt. Click an arc or a circle to push the involved nodes
            into the cross-panel selection.
          </p>
        </section>

      </div>
    </Teleport>

    <Teleport v-if="controlsTarget" :to="`#${controlsTarget}`">
      <div class="grid grid-cols-2 auto-rows-min gap-1.5">
        <!-- Single subtractive filter. Edge type when the graph has ≥2 of them,
             otherwise node type. Filled = shown, faded = hidden by click. -->
        <ControlSection v-if="filterMode"
          :title="filterMode === 'edge' ? 'Edge types' : 'Node types'" :col-span="2">
          <template #actions>
            <div class="flex items-center gap-2.5">
              <button class="text-[10px] font-medium text-sky-700 hover:text-sky-900 disabled:opacity-30 disabled:hover:text-sky-700"
                :disabled="!anyHidden" @click="clearHidden">Show all</button>
              <button class="text-[10px] font-medium text-sky-700 hover:text-sky-900 disabled:opacity-30 disabled:hover:text-sky-700"
                :disabled="allHidden" @click="hideAll">Hide all</button>
            </div>
          </template>
          <div class="flex flex-wrap gap-1">
            <button
              v-for="t in filterUniverse" :key="t"
              class="type-chip px-1.5 py-0 text-[10px] transition-opacity"
              :style="chipStyle(!hiddenTypes.has(t), filterColor(t))"
              @click="toggleType(t)"
            >{{ t }}</button>
          </div>
          <p class="text-[10px] text-muted mt-1 leading-tight">
            Click a {{ filterMode === 'edge' ? 'relationship' : 'type' }} to hide it; the graph adapts. Faded = hidden.
          </p>
        </ControlSection>

        <ControlSection title="Self-loops" :col-span="2">
          <ControlSwitch
            label="Hide self-loops (type → same type)"
            :model-value="controls.hideSelfLoops"
            @update:model-value="updateControl('hideSelfLoops', $event)"
          />
        </ControlSection>

        <ControlSection title="Drill-down" :col-span="2">
          <button class="text-[11px] text-sky-600 hover:underline flex items-center gap-1" @click="toggleWiden">
            <Spline :size="12" />
            {{ widened ? 'Hide flow table' : 'Show flow table' }}
          </button>
        </ControlSection>
      </div>
    </Teleport>

    <div v-if="loading" class="text-sm text-secondary p-3 surface-recessed rounded-lg">Loading edge flow…</div>
    <div v-if="error" class="text-sm text-red-600 p-3 bg-red-50 rounded-lg border border-red-200">{{ error }}</div>
    <p v-if="!loading && !error && noNodesActive" class="text-[10px] italic text-amber-600 px-1">No data under current filters.</p>

    <div v-if="!loading && !error" :class="widened ? 'grid grid-cols-2 gap-6' : ''">
      <div ref="mainContainer" class="chart-elev w-full min-w-0" style="aspect-ratio: 4/3; position: relative;"></div>
      <div v-if="widened" ref="tableContainer" class="chart-elev w-full min-w-0 h-full p-2" style="position: relative;"></div>
    </div>

    <!-- Direction key: arcs fade from the source end (intense) to the target end
         (light). Only meaningful on directed graphs. -->
    <div v-if="!loading && !error && isDirected()" class="flex items-center gap-1.5 px-1 text-[10px] text-muted">
      <span>source</span>
      <span class="inline-block h-2 w-16 rounded-full"
        :style="{ background: `linear-gradient(to right, ${dirKey.src}, ${dirKey.dst})` }" />
      <span>target</span>
      <span class="text-slate-400">— arcs fade in the flow direction</span>
    </div>

    <!-- Live counts of what the current filter shows. -->
    <p v-if="!loading && !error" class="text-[11px] text-secondary px-1 tabular-nums">
      <strong>{{ visibleStats.nodeCount.toLocaleString() }}</strong> nodes ·
      <strong>{{ visibleStats.edgeCount.toLocaleString() }}</strong> edges in view
      <span class="text-muted">across {{ visibleTypes.length }} type{{ visibleTypes.length === 1 ? '' : 's' }}</span>
    </p>
    <p v-if="!loading && !error" class="text-[10px] leading-tight text-muted px-1">
      <template v-if="edgeFilterActive">Flows recomputed on the active edge subset.</template>
      <template v-else>Click a circle or arc to select its nodes across panels.</template>
    </p>
  </div>
</template>
