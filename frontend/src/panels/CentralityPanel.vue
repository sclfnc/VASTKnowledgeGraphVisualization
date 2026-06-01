<script setup>
// Parametric panel for the 4 single-measure centralities (PR/Eig/Betw/Clos).
// Two views: "By Measure" (measure-characteristic viz, default) and "vs Degree"
// (Deg-vs-Centrality scatter, comparable across measures). The control keys stay
// 'specific'/'generic' internally — only the user-facing labels carry the names.
import { ref, computed, toRef, watch, nextTick } from 'vue'
import { storeToRefs } from 'pinia'
import * as d3 from 'd3'
import { X, ChevronDown, ChevronRight } from 'lucide-vue-next'
import { useCentrality } from '@/composables/useCentrality.js'
import { useNodeTypeColors } from '@/composables/useNodeTypeColors.js'
import { useEffectiveType } from '@/composables/useEffectiveType.js'
import { usePanelContextFromProps } from '@/composables/usePanelContext.js'
import { useSelectionStore } from '@/stores/selection.js'
import { usePanel } from './usePanel.js'
import { useD3Chart } from './useD3Chart.js'
import {
  FORMATTERS, makeTooltip, showTip, hideTip,
  drawGrid, drawAxes, svgFrame, ATTENUATED_OPACITY, SLATE, effectiveTypeListOr, theoryLinkClass,
} from './shared.js'
import ControlSection from './controls/ControlSection.vue'
import ControlToggleGroup from './controls/ControlToggleGroup.vue'

const props = defineProps({
  panelSpec: { type: Object, required: true },
  schema: { type: Object, default: null },
  graphId: { type: String, default: null },
  measure: { type: String, required: true },
  widened: { type: Boolean, default: false },
  expanded: { type: Boolean, default: false },
  controlsTarget: { type: String, default: null },
  theoryTarget: { type: String, default: null },
})

const { data, status } = useCentrality(props.measure)
const { color: typeColor } = useNodeTypeColors(toRef(props, 'schema'))
const { nodeType: effNodeType, nodeTypeList } = useEffectiveType(toRef(props, 'graphId'), toRef(props, 'schema'))
const { controls, updateControl } = usePanel(props, props.panelSpec?.id)
const selection = useSelectionStore()
const { ids: filterSelected } = storeToRefs(selection)
const { activeNodeMask, isActive, edgeFilterActive, noNodesActive } = usePanelContextFromProps(props)

const chartContainer = ref(null)

// All four measures now share the rank-mass bars; only Closeness still branches
// (direction variants + degenerate case), so it's the only per-measure flag.
const isCloseness = computed(() => props.measure === 'closeness')

// Closeness has 1-3 direction variants; pick the active one (undirected/out/in).
const closenessVariant = computed(() => {
  if (!isCloseness.value || !data.value) return null
  const dir = controls.value.closeDirection ?? 'undirected'
  return data.value[dir] ?? data.value.undirected ?? null
})

// Unified records accessor across measures.
const valuesPayload = computed(() => {
  if (isCloseness.value) return closenessVariant.value
  return data.value
})

const allValues = computed(() => valuesPayload.value?.values ?? [])

const labelFor = computed(() => ({
  spectral_pagerank: 'PageRank',
  spectral_eigenvector: 'Eigenvector',
  betweenness: 'Betweenness',
  closeness: 'Closeness',
}[props.measure] ?? 'Centrality'))

// Static per-measure prose for the PanelFocus theory drawer: a plain-language
// line for non-experts + a technical line for data scientists. Keyed by the
// measure prop; `title` reuses labelFor so the two never drift.
const MEASURE_THEORY = {
  spectral_pagerank: {
    plain: 'PageRank imagines a random surfer hopping along edges, occasionally teleporting. A node scores high when the surfer lands on it often — i.e. many paths funnel into it.',
    technical: 'Stationary distribution of a damped random walk (damping 0.85); scores sum to 1, so each value is a share of the total rank mass.',
  },
  spectral_eigenvector: {
    plain: 'Eigenvector centrality rewards being connected to other important nodes, not just to many of them. Influence spreads by association.',
    technical: 'Leading eigenvector of the adjacency matrix on the LCC; diffusive importance dominates raw degree. Nodes outside the LCC are excluded.',
  },
  betweenness: {
    plain: 'Betweenness finds the bridges: nodes that sit on the shortest path between many other pairs, so removing them would cut the network apart.',
    technical: 'Fraction of all-pairs shortest paths passing through a node (exact Brandes). Heavy-tailed — a few structural holes hold most of the mass.',
  },
  closeness: {
    plain: 'Closeness measures how near a node is to everything else: high closeness means short hops to the rest of the network.',
    technical: 'Inverse mean shortest-path distance, per-component Wasserman-Faust normalized so values are comparable across components.',
  },
}
const measureTheory = computed(() => ({
  title: labelFor.value,
  ...(MEASURE_THEORY[props.measure] ?? { plain: '', technical: '' }),
}))

// Derived concentration stats for the "In this graph" section. Computed over
// the full scored set (allValues), independent of the active type subset, so
// the prose describes the graph, not the current filter.
const theoryStats = computed(() => {
  const vals = allValues.value
  if (!vals.length) return null
  const sorted = [...vals].sort((a, b) => b.value - a.value)
  const total = d3.sum(sorted, r => r.value)
  if (!(total > 0)) return null
  const top = sorted[0]
  // How many top nodes hold half the total mass — a one-number concentration read.
  let acc = 0
  let halfCount = 0
  for (const r of sorted) {
    acc += r.value
    halfCount++
    if (acc >= total / 2) break
  }
  const n = sorted.length
  return {
    topId: top.id,
    topType: effNodeType(top),
    topShare: top.value / total,
    halfCount,
    halfPct: halfCount / n,
    n,
    typeCount: new Set(vals.map(r => effNodeType(r))).size,
  }
})

watch(
  [data, status, controls, filterSelected, activeNodeMask],
  () => nextTick(renderChart),
  { deep: true },
)

useD3Chart(chartContainer, renderChart, () => [props.widened, props.expanded])

function renderChart() {
  if (!chartContainer.value) return
  if (status.value !== 'ready') return
  d3.select(chartContainer.value).selectAll('*').remove()

  if (controls.value.view === 'generic') {
    renderGenericScatter()
    return
  }
  // All four measures share the rank-mass bars as their "By Measure" view —
  // one honest, comparable encoding (top-N nodes, share of total mass, colored
  // by type). Measure-specific overlays can be layered back later if a measure
  // genuinely needs one; for now the view is unified.
  renderRankMassBars()
}

// Zero-margin frame; each renderer sets its own inner margins below.
const ZERO_MARGINS = { top: 0, right: 0, bottom: 0, left: 0 }
function frame() {
  const el = chartContainer.value
  const { totalW, totalH } = svgFrame(el, ZERO_MARGINS, { fallbackW: 600 })
  return { el, totalW, totalH }
}

// Generic: Degree vs Centrality scatter.
function renderGenericScatter() {
  const { el, totalW, totalH } = frame()
  const MARGINS = { top: 8, right: 12, bottom: 38, left: 56 }
  const innerW = Math.max(0, totalW - MARGINS.left - MARGINS.right)
  const innerH = Math.max(0, totalH - MARGINS.top - MARGINS.bottom)
  if (innerW < 50 || innerH < 50) return

  const svg = d3.select(el).append('svg').attr('width', totalW).attr('height', totalH)
  const g = svg.append('g').attr('transform', `translate(${MARGINS.left},${MARGINS.top})`)
  const tooltip = makeTooltip(el)

  // Type subset from the shared picker (the scatter has no in-chart legend —
  // the drawer's Active/Available chips are both legend and filter). null/empty
  // = all types. Drops, unlike the log-axis drops below, are an explicit user
  // choice, so they're not counted in the "hidden (log axis)" caption.
  const allowedTypes = computedShowTypes()
  const pts = allValues.value.filter(r => allowedTypes.has(effNodeType(r)))

  // Log axes can't plot x=0 / y=0 — this is a rendering constraint of THIS view,
  // not a global filter. The global filter never removes marks here; it attenuates
  // them via activeNodeMask (isActive). So the only drop is the log-axis one, and
  // its count is captioned as such (not as "isolated nodes", which conflated a
  // math constraint with filters.hideIsolated).
  const useLogX = !!controls.value.xLog
  const useLogY = !!controls.value.yLog
  let visible = pts
  if (useLogX) visible = visible.filter(r => r.degree > 0)
  if (useLogY) visible = visible.filter(r => r.value > 0)
  const logHidden = pts.length - visible.length
  if (!visible.length) return

  const xExtent = d3.extent(visible, d => d.degree)
  const yExtent = d3.extent(visible, d => d.value)
  const xScale = (useLogX ? d3.scaleLog() : d3.scaleLinear())
    .domain([useLogX ? Math.max(1, xExtent[0]) : xExtent[0], xExtent[1]])
    .range([0, innerW]).clamp(true)
  const yScale = (useLogY ? d3.scaleLog() : d3.scaleLinear())
    .domain([useLogY ? Math.max(1e-12, yExtent[0]) : 0, yExtent[1]])
    .range([innerH, 0]).clamp(true)

  drawGrid(g, xScale, yScale, innerW, innerH)

  const selectedSet = new Set(filterSelected.value ?? [])

  // 2D rubber-band brush → selection.replace of the nodes whose (degree, value)
  // point falls inside the box. Inserted first (below the dots in z-order) so a
  // single click still reaches a dot's hit circle; a drag in empty space draws
  // the box. Empty selection = no-op (doesn't clear — use a fresh box or click).
  installScatterBrush(g, innerW, innerH, visible, xScale, yScale)

  g.selectAll('circle.dot').data(visible).join('circle')
    .attr('class', 'dot')
    .attr('cx', d => xScale(d.degree))
    .attr('cy', d => yScale(d.value))
    .attr('r', 3)
    .attr('fill', d => typeColor(effNodeType(d)))
    .attr('stroke', d => selectedSet.has(d.id) ? SLATE[900] : 'none')
    .attr('stroke-width', d => selectedSet.has(d.id) ? 1.5 : 0)
    .attr('opacity', d => isActive(d.id) ? 0.7 : ATTENUATED_OPACITY)
    .style('pointer-events', 'none')
  // Transparent hit layer so the small dots are comfortably clickable.
  g.selectAll('circle.hit').data(visible).join('circle')
    .attr('class', 'hit')
    .attr('cx', d => xScale(d.degree))
    .attr('cy', d => yScale(d.value))
    .attr('r', 6).attr('fill', 'transparent')
    .style('cursor', 'pointer')
    .on('mouseover', (ev, d) => showTip(tooltip, ev,
      `<strong>${d.id}</strong><br>${effNodeType(d)}<br>deg ${d.degree} · ${labelFor.value} ${FORMATTERS.exponential(d.value)}`))
    .on('mousemove', (ev) => showTip(tooltip, ev, null))
    .on('mouseout', () => hideTip(tooltip))
    .on('click', (_, d) => toggleSelected(d.id))

  drawAxes(g, xScale, yScale, innerW, innerH, {
    xLabel: 'Degree k', yLabel: labelFor.value,
    yTickFmt: useLogY ? '.0e' : '.2~e',
  })

  // No in-chart legend: the drawer's Show-types chips carry the color↔type
  // mapping and double as the filter. Keeps the scatter clean on 42-type graphs.

  const captions = []
  if (logHidden) captions.push(`${logHidden} node${logHidden === 1 ? '' : 's'} hidden (log axis)`)
  if (props.measure === 'spectral_eigenvector') {
    const excluded = data.value?.excluded_nodes ?? 0
    if (excluded > 0) captions.push(`${excluded} nodes outside LCC excluded`)
  }
  if (captions.length) {
    svg.append('text')
      .attr('x', totalW - 8).attr('y', totalH - 4)
      .attr('text-anchor', 'end').attr('font-size', '10px').attr('fill', SLATE[400])
      .text(captions.join(' · '))
  }
}

// 2D brush over the scatter plot area. Sits below the dots in z-order so dot
// clicks (toggle) still fire; a drag in empty space rubber-bands a box and
// replaces the selection with the nodes inside it. `pts` are the already-
// visible records (type-filtered + log-axis-filtered) with their scales.
function installScatterBrush(parentG, innerW, innerH, pts, xScale, yScale) {
  const brushG = parentG.insert('g', ':first-child').attr('class', 'scatter-brush')
  const brush = d3.brush()
    .extent([[0, 0], [innerW, innerH]])
    .on('end', (event) => {
      if (!event.sourceEvent) return     // ignore programmatic moves
      const sel = event.selection
      if (!sel) return                   // empty box / pure click = no-op
      const [[x0, y0], [x1, y1]] = sel
      const ids = []
      for (const d of pts) {
        const px = xScale(d.degree)
        const py = yScale(d.value)
        if (px >= x0 && px <= x1 && py >= y0 && py <= y1) ids.push(d.id)
      }
      // Replace: each new box is a fresh selection. Empty box already returned.
      if (ids.length) selection.replace(ids)
      // Clear the visible rectangle so it doesn't linger over the next gesture.
      brushG.call(brush.move, null)
    })
  brushG.call(brush)
  // Let the dots' hit circles receive clicks: the brush overlay only acts on drag.
  brushG.select('.overlay').style('cursor', 'crosshair')
}

// Rank-mass bars — the shared "By Measure" view for PageRank and Eigenvector.
// Top-N nodes by the measure value, bar = share of total mass, color = type.
// Honest for both: PageRank sums to 1 by construction, Eigenvector doesn't, but
// "% of total" is a valid relative-concentration read in either case.
function renderRankMassBars() {
  const { el, totalW, totalH } = frame()

  // Full-graph denominator preserves "% of total mass" under type subsetting.
  const denom = d3.sum(allValues.value, r => r.value) || 1

  const allowedTypes = computedShowTypes()
  const filtered = allValues.value
    .filter(r => allowedTypes.has(effNodeType(r)))
    .sort((a, b) => b.value - a.value)
    .slice(0, controls.value.topN || 20)

  if (!filtered.length) return

  // Reserve a right-hand band for the type legend so it never overlaps the bars
  // or the percentage labels. Width tracks the longest legend label (≈6px/char
  // at 10px) + swatch + value-label overflow room.
  const legendTypes = [...new Set(filtered.map(r => effNodeType(r)))]
  const longestLabel = legendTypes.reduce((m, t) => Math.max(m, t.length), 0)
  const LEGEND_BAND = Math.min(140, Math.max(64, longestLabel * 6 + 40))
  const MARGINS = { top: 12, right: LEGEND_BAND, bottom: 28, left: 110 }

  const innerW = Math.max(0, totalW - MARGINS.left - MARGINS.right)
  const innerH = Math.max(0, totalH - MARGINS.top - MARGINS.bottom)
  if (innerW < 50 || innerH < 50) return

  const svg = d3.select(el).append('svg').attr('width', totalW).attr('height', totalH)
  const g = svg.append('g').attr('transform', `translate(${MARGINS.left},${MARGINS.top})`)
  const tooltip = makeTooltip(el)

  // Pad the domain 12% past the top bar so its trailing percentage label stays
  // inside the plot area instead of bleeding into the legend band on the right.
  const xMax = filtered[0].value / denom
  const xScale = d3.scaleLinear().domain([0, xMax * 1.12]).range([0, innerW])
  const yScale = d3.scaleBand().domain(filtered.map(r => r.id)).range([0, innerH]).padding(0.18)

  const truncate = s => s.length > 14 ? s.slice(0, 12) + '…' : s
  const yAxis = d3.axisLeft(yScale).tickFormat(d => truncate(String(d)))
  g.append('g').call(yAxis)
    .selectAll('text').attr('font-size', 10).attr('fill', SLATE[600])

  const xAxis = d3.axisBottom(xScale).ticks(4, '.0%')
  g.append('g').attr('transform', `translate(0,${innerH})`).call(xAxis)
    .selectAll('text').attr('font-size', 10).attr('fill', SLATE[500])

  svg.append('text')
    .attr('x', MARGINS.left + innerW / 2).attr('y', totalH - 4)
    .attr('text-anchor', 'middle').attr('font-size', 11).attr('fill', SLATE[600])
    .text(`% of total ${labelFor.value} mass`)

  const selectedSet = new Set(filterSelected.value ?? [])

  g.selectAll('rect.bar').data(filtered).join('rect')
    .attr('class', 'bar')
    .attr('x', 0)
    .attr('y', d => yScale(d.id))
    .attr('width', d => xScale(d.value / denom))
    .attr('height', yScale.bandwidth())
    .attr('fill', d => typeColor(effNodeType(d)))
    .attr('stroke', d => selectedSet.has(d.id) ? SLATE[900] : 'none')
    .attr('stroke-width', d => selectedSet.has(d.id) ? 1.5 : 0)
    .attr('opacity', d => isActive(d.id) ? 0.85 : ATTENUATED_OPACITY)
    .style('cursor', 'pointer')
    .on('mouseover', (ev, d) => showTip(tooltip, ev,
      `<strong>${d.id}</strong><br>${effNodeType(d)}<br>${labelFor.value} ${FORMATTERS.exponential(d.value)}<br>${((d.value / denom) * 100).toFixed(2)}% of total`))
    .on('mousemove', (ev) => showTip(tooltip, ev, null))
    .on('mouseout', () => hideTip(tooltip))
    .on('click', (_, d) => toggleSelected(d.id))

  g.selectAll('text.pct').data(filtered).join('text')
    .attr('class', 'pct')
    .attr('x', d => xScale(d.value / denom) + 4)
    .attr('y', d => yScale(d.id) + yScale.bandwidth() / 2)
    .attr('dy', '0.35em')
    .attr('font-size', 10).attr('fill', SLATE[600])
    .text(d => `${((d.value / denom) * 100).toFixed(2)}%`)

  // Legend, left-anchored inside the reserved right band so it grows rightward
  // (away from the bars) instead of leftward into them. drawTypeLegend anchors
  // to the SVG right edge with text-anchor:end, which overlaps the plot when
  // labels are long (e.g. "Dept 36") — hence the local left-anchored variant.
  const legendX = MARGINS.left + innerW + 14
  legendTypes.forEach((t, i) => {
    const ly = MARGINS.top + 6 + i * 14
    svg.append('circle').attr('cx', legendX).attr('cy', ly).attr('r', 3.5)
      .attr('fill', typeColor(t))
    svg.append('text').attr('x', legendX + 8).attr('y', ly + 4)
      .attr('text-anchor', 'start').attr('font-size', '10px')
      .attr('fill', SLATE[500]).text(t)
  })
}

// Sentinel: `null` → all types (compact default); an explicit array (incl.
// empty `[]` from Remove all) → exactly that set. An empty set yields charts
// with no marks — callers render an empty-state caption.
function computedShowTypes() {
  const all = effectiveTypeListOr(nodeTypeList.value, props.schema?.node_types)
  const sel = controls.value.showTypes
  if (sel == null) return new Set(all)
  return new Set(sel)
}

function toggleSelected(id) {
  selection.toggle(id)
}

// Couples both scatter axes onto the same Lin/Log scale (single toggle).
function setScatterScale(mode) {
  const log = mode === 'log'
  updateControl('xLog', log)
  updateControl('yLog', log)
}

const SCALE_OPTIONS = [{ k: 'lin', label: 'Lin' }, { k: 'log', label: 'Log' }]

// Keys stay 'specific'/'generic' (used by every render branch + control gate);
// only the user-facing labels change. 'By Measure' = the measure's native viz
// (rank-mass bars / Lorenz / violins / decay shells); 'vs Degree' = the shared
// degree-vs-centrality scatter, identical across all four measures.
const VIEW_OPTIONS = [
  { k: 'specific', label: 'By Measure' },
  { k: 'generic', label: 'vs Degree' },
]
// Capped at 40: rank-mass bars carry node-name + percentage labels, so beyond
// ~40 the bands collapse to a few px on a 4:3 card and the tail is all ~0%.
const TOP_N_OPTIONS = [
  { k: 10, label: '10' }, { k: 20, label: '20' }, { k: 40, label: '40' },
]
const DIRECTION_OPTIONS = [
  { k: 'undirected', label: 'Undirected' },
  { k: 'out', label: 'Out' },
  { k: 'in', label: 'In' },
]

// Shared "Show types" picker — Active/Available split, mirroring
// DegreeDistribution. `controls.showTypes` keeps the compact `null = all`
// semantics (read by computedShowTypes); the picker is a view over it. It
// governs the "vs Degree" scatter on all four measures, and additionally the
// PageRank "By Measure" bars. Active = the resolved shown set; Available = rest.

// Types ordered by their single most-central node: max(centrality value) over
// the type's nodes, descending. Ordering only — every type starts ACTIVE, the
// user filters by hand. We deliberately do NOT auto-trim to a top-N default:
//
//   Intrinsic limitation — on high-arity schemas (e.g. email-eu-core, 42
//   effective types) the Active list becomes a long wall of chips and the
//   per-type marks get visually noisy. There is no clean automatic default
//   that's both honest and stable: ranking types by summed value rewards
//   cardinality (wrong); a top-N-by-peak default hides types silently. So we
//   show everything and leave curation to the user. This is a known trade-off
//   of a per-type breakdown on many-typed graphs, not a bug.
//
// Peak (max) is chosen over sum because it answers "which types own the most
// central nodes" — a type with 3 strong hubs ranks above a type with 10k
// mediocre nodes. Computed over the FULL graph, independent of the active
// subset, so chips never reshuffle while the user edits the set.
const typePeakDesc = computed(() => {
  const peak = new Map()
  for (const r of allValues.value) {
    const t = effNodeType(r)
    const v = r.value || 0
    if (v > (peak.get(t) ?? -Infinity)) peak.set(t, v)
  }
  const all = effectiveTypeListOr(nodeTypeList.value, props.schema?.node_types)
  // Stable total order: peak desc, ties broken by label.
  return [...all].sort((a, b) => (peak.get(b) ?? -Infinity) - (peak.get(a) ?? -Infinity) || a.localeCompare(b))
})
const allMeasureTypes = computed(() => typePeakDesc.value)

// Resolved active set. Sentinel semantics: `null` → all types shown (compact
// default); an explicit array (incl. empty `[]` from Remove all) → exactly that
// set. Inherits the peak-desc order.
const shownTypesList = computed(() => {
  const cur = controls.value.showTypes
  if (cur == null) return [...allMeasureTypes.value]
  // Preserve canonical (peak-desc) order; drop stale labels from a prior graph.
  return allMeasureTypes.value.filter(t => cur.includes(t))
})
const availableMeasureTypes = computed(() =>
  allMeasureTypes.value.filter(t => !shownTypesList.value.includes(t)))

// The Show-types picker shows on the rank-mass bars (all four measures) and on
// the scatter. Mirrors the ControlSection v-if so the empty-state can gate on it.
const typePickerVisible = computed(() => allMeasureTypes.value.length > 1)

// Available picker: open by default, collapsible (matches DegreeDistribution).
const typesAvailableOpen = ref(true)

function toggleMeasureType(t) {
  const all = allMeasureTypes.value
  const cur = (!controls.value.showTypes || controls.value.showTypes.length === 0)
    ? [...all]
    : [...controls.value.showTypes]
  const i = cur.indexOf(t)
  if (i === -1) cur.push(t); else cur.splice(i, 1)
  // Collapse to the compact "all" sentinel when every type is on. An empty set
  // is allowed here (charts render an empty-state) — Remove all relies on it.
  if (cur.length === all.length) updateControl('showTypes', null)
  else updateControl('showTypes', cur)
}

// Add all → the compact `null` sentinel (= all types). Remove all → explicit
// empty array; the charts show an empty-state for "no type active".
function addAllTypes() { updateControl('showTypes', null) }
function removeAllTypes() { updateControl('showTypes', []) }
</script>

<template>
  <div class="flex flex-col gap-1.5">
    <Teleport v-if="controlsTarget" :to="`#${controlsTarget}`">
      <div class="grid grid-cols-2 auto-rows-min gap-1.5">
        <ControlSection title="View" :col-span="2">
          <ControlToggleGroup :model-value="controls.view" :options="VIEW_OPTIONS"
            @update:model-value="updateControl('view', $event)" />
        </ControlSection>

        <!-- Closeness keeps the Direction selector: it picks which variant
             (undirected / out / in) feeds the shared rank-mass bars. -->
        <ControlSection v-if="isCloseness && schema?.directed" title="Direction" :col-span="2">
          <ControlToggleGroup :model-value="controls.closeDirection" :options="DIRECTION_OPTIONS"
            @update:model-value="updateControl('closeDirection', $event)" />
        </ControlSection>

        <!-- Single Lin/Log toggle that couples both axes (degree-vs-centrality
             scatters are read log-log or lin-lin; the mixed case isn't useful
             here). Drives xLog + yLog together. -->
        <ControlSection v-if="controls.view === 'generic'" title="Scale" :col-span="2">
          <ControlToggleGroup :model-value="controls.xLog ? 'log' : 'lin'" :options="SCALE_OPTIONS"
            @update:model-value="setScatterScale($event)" />
        </ControlSection>

        <!-- Top N for the rank-mass bars (shared by all four measures). -->
        <ControlSection v-if="controls.view === 'specific'" title="Top N">
          <ControlToggleGroup :model-value="controls.topN" :options="TOP_N_OPTIONS"
            @update:model-value="updateControl('topN', $event)" />
        </ControlSection>
        <!-- Show types: Active/Available split (same UX as DegreeDistribution).
             Shared by the PageRank "By Measure" bars and the "vs Degree" scatter
             on all four measures — the scatter has no in-chart legend, so these
             chips are both legend and filter. Active left (removable with ×),
             Available right behind a chevron so high-arity graphs (email-eu-core:
             42 types) stay readable. -->
        <ControlSection
          v-if="typePickerVisible"
          title="Show types" :col-span="2">
          <p class="text-[10px] leading-tight text-muted px-0.5 mb-1.5">
            <template v-if="controls.view === 'generic'">
              Filters the scatter and acts as its legend. Ordered by each type's most central node — all start active, deselect to declutter.
            </template>
            <template v-else>
              Ordered by each type's most central node ({{ labelFor }}). All types start active — deselect to declutter on many-typed graphs.
            </template>
          </p>
          <div class="grid grid-cols-2 gap-3">
            <div class="flex flex-col gap-1 min-w-0">
              <!-- Bulk actions live next to "Active" — they act on the active set. -->
              <div class="flex items-center justify-between gap-2">
                <span class="text-[9px] font-semibold uppercase tracking-wide text-muted">
                  Active ({{ shownTypesList.length }})
                </span>
                <div class="flex items-center gap-2.5">
                  <button
                    class="text-[10px] font-medium text-sky-700 hover:text-sky-900 disabled:opacity-30 disabled:hover:text-sky-700"
                    :disabled="shownTypesList.length === allMeasureTypes.length"
                    @click="addAllTypes">Add all</button>
                  <button
                    class="text-[10px] font-medium text-sky-700 hover:text-sky-900 disabled:opacity-30 disabled:hover:text-sky-700"
                    :disabled="shownTypesList.length === 0"
                    @click="removeAllTypes">Remove all</button>
                </div>
              </div>
              <div class="flex flex-wrap gap-1 max-h-44 overflow-y-auto pr-0.5">
                <button v-for="t in shownTypesList" :key="'a-'+t"
                  class="type-chip px-1.5 py-0 text-[10px] inline-flex items-center gap-1"
                  :style="{ backgroundColor: typeColor(t) + '22', borderColor: typeColor(t), color: typeColor(t) }"
                  @click="toggleMeasureType(t)">
                  {{ t }}
                  <X :size="9" class="opacity-60" />
                </button>
                <span v-if="!shownTypesList.length" class="text-[10px] text-muted italic">No type active.</span>
              </div>
            </div>
            <div class="flex flex-col gap-1 min-w-0">
              <button
                class="flex items-center gap-1 text-[9px] font-semibold uppercase tracking-wide text-muted hover:text-secondary"
                :disabled="!availableMeasureTypes.length"
                :title="availableMeasureTypes.length ? (typesAvailableOpen ? 'Collapse' : 'Expand to add types') : 'All types active'"
                @click="typesAvailableOpen = !typesAvailableOpen"
              >
                <component :is="typesAvailableOpen ? ChevronDown : ChevronRight" :size="11" class="shrink-0" />
                <span>Available ({{ availableMeasureTypes.length }})</span>
              </button>
              <div v-if="typesAvailableOpen" class="flex flex-wrap gap-1 max-h-44 overflow-y-auto pr-0.5">
                <button v-for="t in availableMeasureTypes" :key="'i-'+t"
                  class="type-chip px-1.5 py-0 text-[10px]"
                  :style="{ borderColor: typeColor(t), color: typeColor(t) }"
                  @click="toggleMeasureType(t)">{{ t }}</button>
                <span v-if="!availableMeasureTypes.length" class="text-[10px] text-muted italic">All types active.</span>
              </div>
            </div>
          </div>
        </ControlSection>
      </div>
    </Teleport>

    <!-- Interactive theory block teleported into PanelFocus's drawer. Inline
         links drive the panel's own controls so the reader can switch view,
         Top N and (closeness) direction straight from the prose. -->
    <Teleport v-if="theoryTarget" :to="`#${theoryTarget}`">
      <div class="flex flex-col gap-4 text-sm leading-relaxed text-secondary">

        <section class="flex flex-col gap-2">
          <h3 class="text-xs font-semibold uppercase tracking-widest text-muted">What {{ measureTheory.title }} measures</h3>
          <p>{{ measureTheory.plain }}</p>
          <p class="text-[13px] text-slate-600">{{ measureTheory.technical }}</p>
        </section>

        <section class="flex flex-col gap-2">
          <h3 class="text-xs font-semibold uppercase tracking-widest text-muted">Reading this panel</h3>
          <p>
            The
            <button :class="theoryLinkClass(controls.view === 'specific')"
              @click="updateControl('view', 'specific')">By Measure</button>
            view ranks the
            <button :class="theoryLinkClass(false)"
              @click="updateControl('topN', controls.topN === 10 ? 20 : controls.topN === 20 ? 40 : 10)">top {{ controls.topN }}</button>
            nodes; each bar is that node's <strong>share of the total {{ measureTheory.title }} mass</strong>, so a long bar means one node concentrates a large slice of the whole network's score.
          </p>
          <p>
            The
            <button :class="theoryLinkClass(controls.view === 'generic')"
              @click="updateControl('view', 'generic')">vs Degree</button>
            view plots each node's {{ measureTheory.title }} against its <strong>degree</strong> (number of connections). Points off the diagonal are the interesting ones: high {{ measureTheory.title }} with low degree means a node punches above its raw connectivity. Drag a box to select those nodes across every panel.
          </p>
          <p v-if="measure === 'closeness' && schema?.directed">
            On this directed graph you can read closeness as
            <button :class="theoryLinkClass(controls.closeDirection === 'undirected')"
              @click="updateControl('closeDirection', 'undirected')">undirected</button>,
            <button :class="theoryLinkClass(controls.closeDirection === 'out')"
              @click="updateControl('closeDirection', 'out')">out</button>
            or
            <button :class="theoryLinkClass(controls.closeDirection === 'in')"
              @click="updateControl('closeDirection', 'in')">in</button>.
          </p>
        </section>

        <section v-if="theoryStats" class="flex flex-col gap-2">
          <h3 class="text-xs font-semibold uppercase tracking-widest text-muted">In this graph</h3>
          <p>
            The most central node is <strong>{{ theoryStats.topId }}</strong>
            <template v-if="theoryStats.typeCount > 1"> (<span :style="{ color: typeColor(theoryStats.topType) }" class="font-medium">{{ theoryStats.topType }}</span>)</template>,
            holding <strong>{{ (theoryStats.topShare * 100).toFixed(theoryStats.topShare < 0.01 ? 2 : 1) }}%</strong> of all {{ measureTheory.title }} mass on its own.
          </p>
          <p>
            Just <strong>{{ FORMATTERS.integer(theoryStats.halfCount) }}</strong>
            of the <strong>{{ FORMATTERS.integer(theoryStats.n) }}</strong> scored nodes
            ({{ (theoryStats.halfPct * 100).toFixed(theoryStats.halfPct < 0.01 ? 2 : 1) }}%) hold <strong>half</strong> the total —
            <template v-if="theoryStats.halfPct < 0.1">a sharply concentrated, hub-dominated network.</template>
            <template v-else-if="theoryStats.halfPct < 0.35">a moderately concentrated network.</template>
            <template v-else>a fairly even spread, with no single node dominating.</template>
          </p>
          <p v-if="theoryStats.typeCount > 1" class="rounded-md bg-slate-50 px-3 py-2 text-[13px] text-slate-700">
            <strong>Tip:</strong> with <strong>{{ theoryStats.typeCount }}</strong> node types, open the panel <strong>settings</strong> (controls icon, top-right) and use <strong>Show types</strong> to focus the bars and scatter on the types you care about.
          </p>
        </section>

      </div>
    </Teleport>

    <div v-if="status === 'error'" class="flex flex-1 items-center justify-center text-sm text-red-600 surface-recessed rounded-lg p-3">
      Errore durante il calcolo di {{ labelFor }}.
    </div>
    <div v-else-if="status === 'cancelled'" class="flex flex-1 items-center justify-center text-sm text-secondary surface-recessed rounded-lg p-3 italic">
      Calcolo di {{ labelFor }} annullato.
    </div>
    <div v-else-if="status !== 'ready'" class="flex flex-1 items-center justify-center text-sm text-secondary surface-recessed rounded-lg p-3">
      Computing {{ labelFor }}…
    </div>
    <p v-if="status === 'ready' && noNodesActive" class="text-[10px] italic text-amber-600 px-1">No data under current filters.</p>
    <p v-else-if="status === 'ready' && edgeFilterActive" class="text-[10px] italic text-muted px-1">
      {{ labelFor }} computed on the full graph; edge filter attenuates marks only.
    </p>

    <!-- Remove all → empty type set: render an explanatory empty-state instead
         of a blank chart. Only on the views that read the type picker. -->
    <div
      v-if="status === 'ready' && typePickerVisible && !shownTypesList.length"
      class="chart-elev flex w-full flex-col items-center justify-center gap-2 px-6 text-center"
      style="aspect-ratio: 4/3;"
    >
      <p class="text-sm font-medium text-primary">No node type selected.</p>
      <p class="text-xs text-secondary">
        All types were removed in <strong>Show types</strong>. Re-add one (or <strong>Add all</strong>) to see the chart.
      </p>
    </div>
    <div
      v-else-if="status === 'ready'"
      ref="chartContainer" class="chart-elev w-full" style="aspect-ratio: 4/3; position: relative;"
    ></div>
  </div>
</template>
