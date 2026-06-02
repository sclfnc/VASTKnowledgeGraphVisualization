<script setup>
import { ref, watch, toRef, computed, nextTick } from 'vue'
import * as d3 from 'd3'
import { X, ChevronDown, ChevronRight } from 'lucide-vue-next'
import { injectGraphNodes } from '@/composables/useGraphNodes.js'
import { useDegreeFit } from '@/composables/useDegreeFit.js'
import { useNodeTypeColors } from '@/composables/useNodeTypeColors.js'
import { useEffectiveType } from '@/composables/useEffectiveType.js'
import { usePanelContextFromProps } from '@/composables/usePanelContext.js'
import { useSelectionStore } from '@/stores/selection.js'
import { useFiltersStore } from '@/stores/filters.js'
import {
  FORMATTERS, COLOR_SCHEME, SLATE, summaryStats, theoryLinkClass,
  makeTooltip, showTip, hideTip, attachVLineTooltip,
  drawGrid, drawAxes, drawLine,
} from './shared.js'
import { usePanel } from './usePanel.js'
import { useD3Chart } from './useD3Chart.js'
import ControlBoolean from './controls/ControlBoolean.vue'
import ControlToggleGroup from './controls/ControlToggleGroup.vue'

const props = defineProps({
  panelSpec: { type: Object, required: true },
  schema: { type: Object, default: null },
  graphId: { type: String, default: null },
  widened: { type: Boolean, default: false },
  expanded: { type: Boolean, default: false },
  controlsTarget: { type: String, default: null },
  theoryTarget: { type: String, default: null },
})

// Histogram derived live from SoA; fits stay anchored to the full graph (CSN framework).
const { nodes, loading, error } = injectGraphNodes(toRef(props, 'graphId'))
const { data: fit } = useDegreeFit(toRef(props, 'graphId'))
const { activeNodeMask, selectedMask, noNodesActive } = usePanelContextFromProps(props)
const selection = useSelectionStore()
const filters = useFiltersStore()
const { color: typeColor, stylesFor, d3SymbolType, symbolPath } = useNodeTypeColors(toRef(props, 'schema'))

// Style per type in the active set: {shape, color}. When two types share a base
// color, it separates them by changing both the shape and the color shade
// together. Recomputed when overlayTypes changes.
const activeStyles = computed(() => stylesFor(overlayTypes.value))
const activeShape = (t) => activeStyles.value[t]?.shape ?? 'circle'
const activeColor = (t) => activeStyles.value[t]?.color ?? typeColor(t)
const { nodeTypeAt } = useEffectiveType(toRef(props, 'graphId'), toRef(props, 'schema'))

// baseline = full graph, active = global mask; both rebuilt O(N) per change.
const baselineData = computed(() => {
  const soa = nodes.value
  if (!soa) return null
  const seq = Array.from(soa.degrees)
  const byType = {}
  for (let i = 0; i < soa.N; i++) {
    const t = nodeTypeAt(i)
    ;(byType[t] ??= []).push(soa.degrees[i])
  }
  return { seq, byType, stats: summaryStats(seq) }
})

const activeData = computed(() => {
  const soa = nodes.value
  const mask = activeNodeMask.value
  if (!soa || !mask) return null
  const seq = []
  const byType = {}
  for (let i = 0; i < soa.N; i++) {
    if (!mask.get(i)) continue
    const d = soa.degrees[i]
    seq.push(d)
    const t = nodeTypeAt(i)
    ;(byType[t] ??= []).push(d)
  }
  return { seq, byType, stats: summaryStats(seq) }
})

// Highlight rings: byType for By-type mode, all (flat Set) for Total mode.
const selectedDegrees = computed(() => {
  const soa = nodes.value
  const sm = selectedMask.value
  if (!soa || !sm) return null
  const byType = new Map()
  const all = new Set()
  for (let i = 0; i < soa.N; i++) {
    if (!sm.get(i)) continue
    const d = soa.degrees[i]
    const t = nodeTypeAt(i)
    if (!byType.has(t)) byType.set(t, new Set())
    byType.get(t).add(d)
    all.add(d)
  }
  return { byType, all }
})

const { controls, updateControl } = usePanel(props, 'degree')
const chartContainer = ref(null)
const view = ref('PMF')

// Mutually exclusive fit: one family at a time (or null = no curve on chart).
// Comparing multiple fits side-by-side hides the underlying question
// ("which model best describes the data?") — pick one and read its Δ AIC.
const fitActive = ref(null)
const fitVisibleMap = computed(() => fitActive.value ? { [fitActive.value]: true } : {})

// Per-type active set in by-type mode. Default = top N types by cardinality —
// keeps the chart readable on high-arity datasets (email-eu-core has 42 types).
// Users can add/remove types via the picker in the drawer; the chip click
// toggles membership. The set controls dots, median, IQR, and the chart legend.
//
// `overlayTypes` is intentionally panel-local and does NOT mirror the global
// `filters.nodeTypes` chip group: the user may want to focus the per-type chart
// on 3 types out of 42 without removing the other 39 from the rest of the
// dashboard. Trade-off: two separate "show this type" controls, no signal between
// them.
const TOP_TYPES_DEFAULT = 6
const overlayTypes = ref([])

const FIT_LABELS = { powerlaw: 'Power law fit', exponential: 'Exponential fit', poisson: 'Poisson fit', lognormal: 'Log-normal fit' }
// Free parameter count per family; AIC = -2·LL + 2·k. Power-law / exp / Poisson
// have 1 free param (xmin fixed at 1, see CSN framework); log-normal has 2 (μ, σ).
const FIT_NPARAMS = { powerlaw: 1, exponential: 1, poisson: 1, lognormal: 2 }

function toggleOverlayType(t) {
  if (overlayTypes.value.includes(t)) {
    overlayTypes.value = overlayTypes.value.filter(x => x !== t)
  } else {
    overlayTypes.value = [...overlayTypes.value, t]
  }
}

function isOverlayOn(t) {
  return overlayTypes.value.includes(t)
}

// Bulk picker actions. Add all → every available type active; Remove all →
// empty set (the per-type chart then renders nothing, by design — the user
// re-adds what they want). Mirrors the CentralityPanel Show-types picker.
function addAllOverlayTypes() { overlayTypes.value = [...availableTypesSortedBySize.value] }
function removeAllOverlayTypes() { overlayTypes.value = [] }

// Available types picker: open by default, collapsible via the header chevron.
// On high-arity graphs (email-eu-core has 42 types) the user can fold it away to
// reclaim drawer space once the active set is chosen.
const availableOpen = ref(true)

const availableTypes = computed(() => Object.keys(baselineData.value?.byType || {}))

// Types sorted by cardinality desc — basis for the default top-N active set
// and for the picker's natural ordering (largest first).
const availableTypesSortedBySize = computed(() => {
  const types = availableTypes.value
  const sizes = baselineData.value?.byType ?? {}
  return [...types].sort((a, b) => (sizes[b]?.length ?? 0) - (sizes[a]?.length ?? 0))
})
const inactiveOverlayTypes = computed(() =>
  availableTypesSortedBySize.value.filter(t => !overlayTypes.value.includes(t)),
)

// Initialise / reconcile overlayTypes whenever the type list changes (graph
// switch, byType activation, schema reload). Keeps the user's selection as long
// as the types still exist; otherwise falls back to top N by size.
watch(availableTypesSortedBySize, (sorted) => {
  if (!sorted.length) { overlayTypes.value = []; return }
  const valid = overlayTypes.value.filter(t => sorted.includes(t))
  if (valid.length > 0 && valid.length === overlayTypes.value.length) return
  overlayTypes.value = sorted.slice(0, TOP_TYPES_DEFAULT)
}, { immediate: true })

// All families fitted on full sequence, xmin=1 fixed → LLs share support and
// can be combined into AIC for parameter-count-aware comparison.
//
// Backend gotcha: the `.ll` field is log-likelihood **per point** (total LL
// divided by n). AIC's data term is on the total LL scale, so multiply back
// by n here. Δ AIC must be on the original scale to use the standard
// interpretation thresholds (< 2 indistinguishable; > 10 ruled out).
function aicOf(name) {
  const llPerPoint = fit.value?.all?.[name]?.ll
  const n = baselineData.value?.seq?.length
  if (llPerPoint == null || !Number.isFinite(llPerPoint) || !n) return null
  return -2 * llPerPoint * n + 2 * FIT_NPARAMS[name]
}

const fitSwitches = computed(() => {
  void fit.value
  // Normalise by n so the metric is scale-invariant. The classic AIC thresholds
  // (< 2, 4-7, > 10) were calibrated for small samples — on large graphs the
  // absolute Δ scales linearly with n and inflates beyond interpretability.
  // Per-point thresholds: < 0.01 indistinguishable, 0.01-0.1 modest, > 0.5 ruled out.
  const n = baselineData.value?.seq?.length || 1
  const entries = Object.keys(FIT_LABELS).map(name => ({
    name,
    label: FIT_LABELS[name],
    aic: aicOf(name),
  }))
  const valid = entries.filter(e => e.aic != null)
  const minAic = valid.length ? Math.min(...valid.map(e => e.aic)) : null
  for (const e of entries) {
    e.deltaAic = e.aic != null && minAic != null ? (e.aic - minAic) / n : null
  }
  // Sort by Δ ascending (best first); invalid entries trail.
  entries.sort((a, b) => {
    if (a.deltaAic == null && b.deltaAic == null) return 0
    if (a.deltaAic == null) return 1
    if (b.deltaAic == null) return -1
    return a.deltaAic - b.deltaAic
  })
  return entries
})

function formatDeltaAic(d) {
  if (d == null) return ''
  if (d === 0) return '——'
  if (d < 0.005) return '<0.01'
  if (d < 1) return d.toFixed(2)
  if (d < 100) return d.toFixed(1)
  return d.toFixed(0)
}

// --- Dynamic theory descriptors (read by the theory teleport block) ---

// Graph-level facts pulled from the full-graph baseline (never the subset).
const theoryStats = computed(() => {
  const s = baselineData.value?.stats
  const seq = baselineData.value?.seq
  if (!s || !seq?.length) return null
  const min = Math.min(...seq), max = Math.max(...seq)
  const skewRatio = s.median > 0 ? max / s.median : null
  return {
    n: seq.length, min, max,
    median: s.median, p25: s.p25, p75: s.p75,
    skewRatio,
    // "strongly skewed" when the top hub has at least 10x the median degree.
    heavyTailed: skewRatio != null && skewRatio >= 10,
  }
})

// Best fit family (first in the Δ-sorted list) + the full ordered list, for
// the theory block. `fitSwitches` is already Δ-sorted ascending.
const theoryFit = computed(() => {
  const entries = fitSwitches.value.filter(e => e.deltaAic != null)
  if (!entries.length) return null
  return { best: entries[0], entries }
})

const VIEWS = ['PMF', 'CCDF']
const VIEW_OPTIONS = VIEWS.map(v => ({ k: v, label: v }))
// Per-type makes sense only when there are ≥2 effective types — on a single-type
// graph it would draw exactly the Total curve. Disable + tooltip explains why.
const hasMultipleTypes = computed(() => availableTypes.value.length > 1)
// More types than the default active set → the per-type chart can't show them
// all; the theory block surfaces a note pointing to the panel settings.
const manyTypes = computed(() => availableTypes.value.length > TOP_TYPES_DEFAULT)
const BY_TYPE_OPTIONS = computed(() => [
  { k: false, label: 'Total' },
  {
    k: true,
    label: 'Per type',
    disabled: !hasMultipleTypes.value,
    title: hasMultipleTypes.value ? '' : 'Only one node type in this graph — Per type is identical to Total.',
  },
])

// Force back to Total if the active graph loses type diversity (graph switch).
watch(hasMultipleTypes, (multi) => {
  if (!multi && controls.value.byType) updateControl('byType', false)
})
const Y_AXIS_OPTIONS = [{ k: 'count', label: 'Count' }, { k: 'probability', label: 'Prob.' }]
const SCALE_OPTIONS = [{ k: 'lin', label: 'Lin' }, { k: 'log', label: 'Log' }]
const MARGINS = { top: 8, right: 12, bottom: 38, left: 44 }

// selection.ids is listed on its own line on purpose. `selectedDegrees` depends
// on it indirectly through `selectedMask`, but the watch can miss that change if
// Vue sees the computed as the "same reference" between reads. Reading the raw
// store array makes Vue register the dependency.
// We use a single getter (the same pattern that works in ConnectedComponents):
// passing an array of mixed refs + getters with { deep:true } made Vue's
// dependency tracking go stale after the first control change — the chart kept
// re-rendering but the teleported drawer stopped reflecting state. A getter that
// returns the value array tracks correctly on every run.
// Render runs on nextTick (same as ConnectedComponents). Calling renderChart
// straight away inside the reactive flush ran the D3 selectAll('*').remove() +
// rebuild in the same tick as the teleported drawer's update, which froze the
// drawer's control bindings from the second interaction on. nextTick lets Vue
// settle the DOM (the drawer included) first.
watch(
  () => [
    activeData.value, baselineData.value, selectedDegrees.value,
    selection.ids, fit.value, controls.value, view.value,
    fitActive.value, overlayTypes.value, filters.degree,
  ],
  () => nextTick(renderChart),
  { deep: true },
)

useD3Chart(chartContainer, renderChart, () => [props.widened, props.expanded])

function buildPMF(seq) {
  const freq = new Map()
  for (const d of seq) freq.set(d, (freq.get(d) || 0) + 1)
  const n = seq.length
  return Array.from(freq.entries(), ([k, count]) => ({ k, p: count / n }))
    .sort((a, b) => a.k - b.k)
}

function buildCCDF(seq) {
  let cum = 0
  return buildPMF(seq).map(d => { const p = 1 - cum; cum += d.p; return { k: d.k, p } })
}

function builderFor(viewName) {
  return viewName === 'CCDF' ? buildCCDF : buildPMF
}

function buildScales(visible, innerW, lineH, useLogX, useLogY) {
  const minK = useLogX ? Math.max(1, d3.min(visible, d => d.k)) : d3.min(visible, d => d.k)
  const maxK = d3.max(visible, d => d.k)
  const minP = d3.min(visible, d => d.p)
  const maxP = d3.max(visible, d => d.p)

  const xScale = useLogX
    ? d3.scaleLog().domain([minK, maxK]).range([0, innerW]).clamp(true)
    : d3.scaleLinear().domain([minK, maxK]).range([0, innerW])
  const yScale = useLogY
    ? d3.scaleLog().domain([Math.max(1e-6, minP), maxP]).range([lineH, 0]).clamp(true)
    : d3.scaleLinear().domain([0, maxP]).range([lineH, 0])
  return { xScale, yScale }
}

// Fitted on full sequence xmin=1: pmf normalised over data support → count scale = * n.
// One family at a time on the chart (mutually exclusive radio); the family is
// identified by the radio + legend label, not by color. The curve is a
// neutral reference line so the data marks stay the primary signal.
const FIT_CURVE_COLOR = COLOR_SCHEME.danger  // saturated "model overlay" hue
const FIT_CURVE_DASH = '3,3'       // dashed = theoretical model, not measured
const FIT_NAMES = ['powerlaw', 'exponential', 'poisson', 'lognormal']

function drawFitCurves(g, fitParams, xScale, yScale, isCCDF, n, yMode, useLogX, visibleMap, colorOverride = null) {
  if (!fitParams) return
  for (const name of FIT_NAMES) {
    if (!visibleMap[name] || !fitParams[name]) continue
    const { grid, pmf, ccdf } = fitParams[name]
    if (!grid || !grid.length) continue
    const probs = isCCDF ? ccdf : pmf
    const scale = yMode === 'count' ? n : 1
    const pts = []
    for (let i = 0; i < grid.length; i++) {
      const k = grid[i]
      const p = probs[i] * scale
      if (!isFinite(p) || p <= 0) continue
      if (useLogX && k < 1) continue
      if (!isFinite(xScale(k)) || !isFinite(yScale(p))) continue
      pts.push({ k, p })
    }
    if (pts.length < 2) continue
    const color = colorOverride ?? FIT_CURVE_COLOR
    // Thicker than the shared default (1.2) so the model curve reads clearly
    // over the data marks.
    drawLine(g, pts, xScale, yScale, color, FIT_CURVE_DASH).attr('stroke-width', 2.2)
  }
}


// Grey baseline overlay; hidden when active == baseline to avoid clutter.
const BASELINE_COLOR = SLATE[400]
const BASELINE_LINE_OPACITY = 0.4
const BASELINE_RECT_OPACITY = 0.06

function selectIdsForBin(k, type = null) {
  const soa = nodes.value
  const mask = activeNodeMask.value
  if (!soa || !mask) return
  const ids = []
  for (let i = 0; i < soa.N; i++) {
    if (!mask.get(i)) continue
    if (soa.degrees[i] !== k) continue
    if (type && nodeTypeAt(i) !== type) continue
    ids.push(soa.ids[i])
  }
  selection.replace(ids)
}

// Brush gesture writes the global degree filter. The chart always renders the
// full-graph baseline (mask-only contract); bins outside the brushed range are
// recolored grey by the normal attenuation path, so the curve keeps its shape.
function setDegreeRange(lo, hi) {
  filters.degree = { mode: 'absolute', value: [Math.round(lo), Math.round(hi)] }
}
const DOM_RANGE = computed(() => {
  const r = props.schema?.degree_range
  return Array.isArray(r) && r.length === 2 ? r : null
})

// Installs a d3.brushX on the plot area. The brush sits BELOW the dots in the
// SVG z-order so that pointer events on a dot reach the dot first (its `click`
// handler still fires for selection). Drag in empty space triggers the brush,
// which on `end` writes filters.degree. A null brush selection (pure click) is
// a no-op — it doesn't clear the filter; use the sidebar slider to reset.
function installBrush(parentG, xScale, innerW, lineH, currentRange) {
  const brushG = parentG.insert('g', ':first-child').attr('class', 'brush-x')
  const brush = d3.brushX()
    .extent([[0, 0], [innerW, lineH]])
    .on('end', (event) => {
      if (!event.sourceEvent) return  // programmatic move() echo
      const sel = event.selection
      if (!sel) return                 // empty brush = treat as no-op
      const [x0, x1] = sel
      const k0 = xScale.invert(x0)
      const k1 = xScale.invert(x1)
      setDegreeRange(Math.max(0, Math.min(k0, k1)), Math.max(k0, k1))
    })
  brushG.call(brush)
  // Reflect the current degree filter as a pre-selected brush rectangle when
  // the filter is narrower than the schema domain. Skips when filter == domain.
  if (currentRange && DOM_RANGE.value) {
    const [lo, hi] = currentRange
    const [domLo, domHi] = DOM_RANGE.value
    if (lo > domLo || hi < domHi) {
      const x0 = xScale(Math.max(lo, xScale.domain()[0]))
      const x1 = xScale(Math.min(hi, xScale.domain()[1]))
      if (isFinite(x0) && isFinite(x1) && x1 > x0) {
        brushG.call(brush.move, [x0, x1])
      }
    }
  }
  // The brush overlay rect is opaque to clicks by default — make it transparent
  // to pointer events on the selection rect itself so the user can interact with
  // dots inside the brushed area.
  brushG.selectAll('.selection').style('pointer-events', 'none')
  brushG.selectAll('.handle').style('pointer-events', 'none')
}

function renderChart() {
  if (!chartContainer.value || !activeData.value || !baselineData.value) return
  d3.select(chartContainer.value).selectAll('*').remove()

  const v = view.value
  const isCCDF = v === 'CCDF'
  const ctrl = controls.value
  const useLogX = ctrl.scale === 'log'
  const useLogY = ctrl.scale === 'log'
  const yMode = ctrl.yAxis === 'count' ? 'count' : 'probability'
  const scaleP = (pts, n) => yMode === 'count' ? pts.map(d => ({ k: d.k, p: d.p * n })) : pts
  const fmtY = yMode === 'count' ? FORMATTERS.number : FORMATTERS.percent

  const totalW = chartContainer.value.clientWidth || 800
  const totalH = chartContainer.value.clientHeight || Math.round(totalW * 3 / 4)
  const innerW = Math.max(0, totalW - MARGINS.left - MARGINS.right)
  const lineH  = Math.max(0, totalH - MARGINS.top - MARGINS.bottom)
  if (innerW < 50 || lineH < 50) return  // card too narrow to render meaningfully

  const svg = d3.select(chartContainer.value).append('svg').attr('width', totalW).attr('height', totalH)
  const tooltip = makeTooltip(chartContainer.value)
  const g = svg.append('g').attr('transform', `translate(${MARGINS.left},${MARGINS.top})`)

  // Descriptive labels for non-experts, with the statistical notation kept in
  // parentheses for the data-scientist reading.
  const xLabel = 'Node degree (k)'
  const yLabel = yMode === 'count'
    ? (isCCDF ? 'Nodes with degree ≥ k' : 'Number of nodes')
    : (isCCDF ? 'Fraction with degree ≥ k  ·  P(K ≥ k)' : 'Fraction of nodes  ·  P(k)')
  const buildFn = builderFor(v)

  // By-type branch.
  if (ctrl.byType) {
    // Iterate baseline types so a fully-masked type stays legible.
    const activeByType = activeData.value.byType
    const baselineByType = baselineData.value.byType
    const types = Object.keys(baselineByType)
    const selByType = selectedDegrees.value?.byType ?? new Map()

    // Per-type follows the same mask-only rule as Total: the PMF/CCDF for each
    // type is computed on the FULL-graph baseline sequence; the active sequence
    // only labels which bins survive the current mask (used to recolor dots).
    const perType = types.map(t => {
      const activeSeq = activeByType[t] ?? []
      const baselineSeq = baselineByType[t] ?? []
      const activeKSet = new Set(activeSeq)
      const pts = baselineSeq.length
        ? scaleP(buildFn(baselineSeq), baselineSeq.length).filter(d => !useLogX || d.k >= 1)
        : []
      return { t, pts, activeKSet }
    })

    const allPts = perType.flatMap(({ pts }) => pts)
    if (!allPts.length) return

    const { xScale, yScale } = buildScales(allPts, innerW, lineH, useLogX, useLogY)
    drawGrid(g, xScale, yScale, innerW, lineH)
    const yLab = yMode === 'count' ? (isCCDF ? 'Count(K ≥ k)' : 'Count') : (isCCDF ? 'P(K ≥ k)' : 'P(k)')
    const tipFor = d => `k = ${d.k}<br>${yLab} = ${fmtY(d.p)}`

    perType.forEach(({ t, pts, activeKSet }) => {
      if (!pts.length) return
      if (!isOverlayOn(t)) return  // skip types the user has deactivated in the picker

      const selSet = selByType.get(t)
      const fillColor = activeColor(t)
      const strokeDarker = d3.color(fillColor).darker(0.8).formatHex()
      const symType = d3SymbolType(activeShape(t))
      // Hollow encoding: shape is read from the outline → larger area so the
      // outline has room. Selected marks fill in for clear highlight contrast.
      // Attenuated bins (no node in mask) collapse to the neutral grey + smaller
      // size, matching Total's attenuation style.
      const typeHasSel = (selSet?.size ?? 0) > 0
      // Selection gap (two-way), matching Total: selected glyphs grow, and once
      // a selection exists in this type the rest shrink a touch. Areas: selected
      // 60, attenuated-by-filter 20, normal 28, shrunk-by-selection 16.
      const symAt = (selected, attenuated) => {
        const area = selected ? 60 : (attenuated ? 20 : (typeHasSel ? 16 : 28))
        return d3.symbol().type(symType).size(area)()
      }
      const isAttenuated = (k) => !activeKSet.has(k)
      // Visible glyph: decorative only (pointer-events disabled). The hollow
      // (fill=none) shape would otherwise capture clicks on its 1.3px outline
      // alone — the whole symbol must be clickable, so a transparent hit circle
      // on top owns all the pointer events.
      g.selectAll(null).data(pts).join('path')
        .attr('transform', d => `translate(${xScale(d.k)},${yScale(d.p)})`)
        .attr('d', d => symAt(selSet?.has(d.k), isAttenuated(d.k)))
        .attr('fill', d => selSet?.has(d.k) ? fillColor : 'none')
        .attr('fill-opacity', d => selSet?.has(d.k) ? 0.85 : 0)
        .attr('stroke', d => selSet?.has(d.k) ? strokeDarker : (isAttenuated(d.k) ? BASELINE_COLOR : fillColor))
        .attr('stroke-width', d => selSet?.has(d.k) ? 1.8 : 1.3)
        .attr('stroke-opacity', 1)
        .style('pointer-events', 'none')
      g.selectAll(null).data(pts).join('circle')
        .attr('cx', d => xScale(d.k)).attr('cy', d => yScale(d.p))
        .attr('r', 5)
        .attr('fill', 'transparent')
        .style('cursor', 'pointer')
        .on('mouseover', (event, d) => showTip(tooltip, event, `<strong>${t}</strong><br>${tipFor(d)}`))
        .on('mousemove', (event) => showTip(tooltip, event, null))
        .on('mouseout', () => hideTip(tooltip))
        .on('click', (_, d) => selectIdsForBin(d.k, t))
    })

    // Per-type mode renders dots + axes + type legend only. Three overlays are
    // intentionally suppressed:
    //   - Aggregate fit curve: it's the FULL-graph fit. Drawing it over per-type
    //     dots can't work as a shared reference: each type's dots live on its OWN
    //     y-scale (PMF/CCDF normalised per type, or count scaled by that type's
    //     cardinality), so a single global curve has no common axis to sit on —
    //     it either falls outside the per-type domain (count mode) or compares
    //     shapes that have no common scale. Per-type fitting, on the other hand, would be
    //     statistically wrong (a fit per matrix/type is not what AIC compares).
    //     So no fit curve here by design; the Fit selector lives in Total only.
    //   - Per-type median / IQR overlays: with N active types each contributing
    //     vertical lines and bands, the chart turns into visual noise; per-type
    //     summary stats live better in a dedicated boxplot view.
    //   - Baseline grey overlay: only meaningful in Total mode where the
    //     subset-vs-full comparison is single-distribution.

    // Legend mirrors dot appearance (shape + color); only active types.
    const legendTypes = perType.filter(p => p.pts.length && isOverlayOn(p.t)).map(p => p.t)
    const legendX = innerW - 10
    legendTypes.forEach((t, i) => {
      const y = 12 + i * 16
      const tColor = activeColor(t)
      g.append('path')
        .attr('transform', `translate(${legendX - 5},${y})`)
        .attr('d', d3.symbol().type(d3SymbolType(activeShape(t))).size(40)())
        .attr('fill', 'none')
        .attr('stroke', tColor).attr('stroke-width', 1.3).attr('opacity', 0.9)
      g.append('text').attr('x', legendX - 12).attr('y', y + 4)
        .attr('text-anchor', 'end').attr('font-size', '11px').attr('fill', tColor).text(t)
    })

    drawAxes(g, xScale, yScale, innerW, lineH, {
      xLabel, yLabel,
      yTickFmt: useLogY ? (yMode === 'count' ? '~s' : '.0e') : (yMode === 'count' ? 'd' : '.0%'),
    })
    installBrush(g, xScale, innerW, lineH, filters.degree?.value)
    return
  }

  // Total branch (PMF / CCDF).
  // The distribution is ALWAYS computed on the full graph (mask-only contract:
  // derived quantities stay anchored to the full graph, marks attenuate).
  // Filters do NOT reshape the curve — they recolor the dots: bins that contain
  // at least one active node are drawn in accent, the rest in baseline grey.
  const activeStats = activeData.value.stats || {}
  const baselineStats = baselineData.value.stats || {}
  const filteredSeq = activeData.value.seq
  const baselineSeq = baselineData.value.seq
  const isSubset = filteredSeq.length < baselineSeq.length
  const points = scaleP(buildFn(baselineSeq), baselineSeq.length)
  const visible = useLogX ? points.filter(d => d.k >= 1) : points
  if (!visible.length) return
  // Which degree-bins survive the current node mask? Used to recolor dots.
  const activeKSet = new Set()
  for (const k of filteredSeq) activeKSet.add(k)

  const { xScale, yScale } = buildScales(visible, innerW, lineH, useLogX, useLogY)
  drawGrid(g, xScale, yScale, innerW, lineH)

  const clamp = val => useLogX ? Math.max(1, val) : val

  // Grey baseline only when active is a strict subset; otherwise it'd duplicate the colored layer.
  if (isSubset && baselineStats.median != null) {
    if (ctrl.showIqr && baselineStats.p25 != null && (!useLogX || baselineStats.p25 >= 1)) {
      const xLo = xScale(clamp(baselineStats.p25)), xHi = xScale(clamp(baselineStats.p75))
      g.append('rect')
        .attr('x', xLo).attr('width', Math.max(0, xHi - xLo))
        .attr('y', 0).attr('height', lineH)
        .attr('fill', BASELINE_COLOR).attr('opacity', BASELINE_RECT_OPACITY).style('pointer-events', 'none')
    }
    if (ctrl.showMedian && (!useLogX || baselineStats.median >= 1)) {
      const x = xScale(baselineStats.median)
      g.append('line').attr('x1', x).attr('x2', x).attr('y1', 0).attr('y2', lineH)
        .attr('stroke', BASELINE_COLOR).attr('stroke-width', 1).attr('stroke-dasharray', '2,3').attr('opacity', BASELINE_LINE_OPACITY)
      attachVLineTooltip(g, x, lineH, `<strong>Median (full)</strong><br>${FORMATTERS.number(baselineStats.median)}`, tooltip)
    }
  }

  if (activeStats.median != null) {
    if (ctrl.showIqr && activeStats.p25 != null && (!useLogX || activeStats.p25 >= 1)) {
      const xLo = xScale(clamp(activeStats.p25)), xHi = xScale(clamp(activeStats.p75))
      g.append('rect')
        .attr('x', xLo).attr('width', Math.max(0, xHi - xLo))
        .attr('y', 0).attr('height', lineH)
        .attr('fill', COLOR_SCHEME.accent).attr('opacity', 0.1).style('pointer-events', 'none')
    }
    if (ctrl.showMedian && (!useLogX || activeStats.median >= 1)) {
      const x = xScale(activeStats.median)
      g.append('line').attr('x1', x).attr('x2', x).attr('y1', 0).attr('y2', lineH)
        .attr('stroke', COLOR_SCHEME.success).attr('stroke-width', 1).attr('stroke-dasharray', '2,3').attr('opacity', 0.55)
      attachVLineTooltip(g, x, lineH, `<strong>Median${isSubset ? ' (subset)' : ''}</strong><br>${FORMATTERS.number(activeStats.median)}`, tooltip)
    }
  }

  const selAll = selectedDegrees.value?.all ?? new Set()
  const hasSel = selAll.size > 0
  const accentDarker = d3.color(COLOR_SCHEME.accent).darker(0.8).formatHex()
  // Single dot layer: bins fall into either "active" (at least one node in the
  // current mask) or "attenuated" (no node in mask). Selected always wins.
  function isBinActive(k) { return activeKSet.has(k) }
  // Selection gap (two-way): when a selection exists, selected bins grow a bit
  // and the rest shrink a bit, widening the contrast without recoloring (the
  // grey/colored channel stays reserved for the filter mask).
  function dotRadius(k) {
    if (selAll.has(k)) return 4.5
    const base = isBinActive(k) ? 3 : 2.6
    return hasSel ? base - 0.8 : base
  }
  // Visible dots are decorative (pointer-events disabled); a transparent hit
  // circle of fixed radius owns clicks/hover so the small marks are
  // comfortably clickable without precise aiming.
  g.selectAll('.dot').data(visible).join('circle')
    .attr('class', 'dot')
    .attr('cx', d => xScale(d.k)).attr('cy', d => yScale(d.p))
    .attr('r', d => dotRadius(d.k))
    .attr('fill', d => isBinActive(d.k) ? COLOR_SCHEME.accent : BASELINE_COLOR)
    .attr('fill-opacity', d => selAll.has(d.k) ? 0.9 : (isBinActive(d.k) ? 0.5 : 0.65))
    .attr('stroke', d => selAll.has(d.k) ? accentDarker : (isBinActive(d.k) ? COLOR_SCHEME.accent : BASELINE_COLOR))
    .attr('stroke-width', d => selAll.has(d.k) ? 1.8 : 0.7)
    .attr('stroke-opacity', 1)
    .style('pointer-events', 'none')
  const yLabTip = yMode === 'count' ? (isCCDF ? 'Nodes with degree ≥ k' : 'Number of nodes') : (isCCDF ? 'P(K ≥ k)' : 'P(k)')
  const totalTip = d => `Degree k = ${d.k}<br>${yLabTip} = ${fmtY(d.p)}`
  g.selectAll(null).data(visible).join('circle')
    .attr('cx', d => xScale(d.k)).attr('cy', d => yScale(d.p))
    .attr('r', 5)
    .attr('fill', 'transparent')
    .style('cursor', 'pointer')
    .on('mouseover', (event, d) => showTip(tooltip, event, totalTip(d)))
    .on('mousemove', (event) => showTip(tooltip, event, null))
    .on('mouseout', () => hideTip(tooltip))
    .on('click', (_, d) => selectIdsForBin(d.k))

  // Anchored to the full graph (CSN); divergence vs subset is the analytic signal.
  drawFitCurves(g, fit.value?.all, xScale, yScale, isCCDF, baselineSeq.length, yMode, useLogX, fitVisibleMap.value)

  // All-mode legend.
  const legendItems = [{ kind: 'dot', color: COLOR_SCHEME.accent, label: 'Data' }]
  for (const name of FIT_NAMES) {
    if (fitVisibleMap.value[name]) legendItems.push({ kind: 'line', color: FIT_CURVE_COLOR, label: FIT_LABELS[name] })
  }
  if (ctrl.showIqr && activeStats.p25 != null) {
    legendItems.push({ kind: 'rect', color: COLOR_SCHEME.accent, label: 'IQR' })
  }
  if (ctrl.showMedian && activeStats.median != null) {
    legendItems.push({ kind: 'vline', color: COLOR_SCHEME.success, label: 'Median' })
  }

  if (legendItems.length > 1) {
    const lx = innerW - 8
    legendItems.forEach(({ kind, color, label }, i) => {
      const ly = 10 + i * 16
      if (kind === 'line') {
        g.append('line').attr('x1', lx - 14).attr('x2', lx).attr('y1', ly).attr('y2', ly)
          .attr('stroke', color).attr('stroke-width', 2.2).attr('stroke-dasharray', FIT_CURVE_DASH).attr('stroke-linecap', 'round').attr('opacity', 0.85)
      } else if (kind === 'vline') {
        g.append('line').attr('x1', lx - 7).attr('x2', lx - 7).attr('y1', ly - 5).attr('y2', ly + 5)
          .attr('stroke', color).attr('stroke-width', 1).attr('stroke-dasharray', '4,3').attr('opacity', 0.7)
      } else if (kind === 'rect') {
        g.append('rect').attr('x', lx - 14).attr('y', ly - 4).attr('width', 14).attr('height', 8)
          .attr('fill', color).attr('opacity', 0.15)
      } else {
        g.append('circle').attr('cx', lx - 7).attr('cy', ly).attr('r', 3)
          .attr('fill', color).attr('opacity', 0.8)
      }
      g.append('text').attr('x', lx - 18).attr('y', ly + 4)
        .attr('text-anchor', 'end').attr('font-size', '11px').attr('fill', SLATE[500]).text(label)
    })
  }

  drawAxes(g, xScale, yScale, innerW, lineH, {
    xLabel, yLabel,
    yTickFmt: useLogY ? (yMode === 'count' ? '~s' : '.0e') : (yMode === 'count' ? 'd' : '.0%'),
  })
  installBrush(g, xScale, innerW, lineH, filters.degree?.value)
}
</script>

<template>
  <div class="flex flex-col gap-1.5">
    <Teleport v-if="controlsTarget" :to="`#${controlsTarget}`">
      <div class="flex flex-col gap-3 text-[10px]">

        <div class="grid grid-cols-2 gap-4 items-stretch">
          <div class="flex flex-col gap-1">
            <span class="text-[9px] font-semibold uppercase tracking-wide text-muted">View</span>
            <ControlToggleGroup :model-value="view" :options="VIEW_OPTIONS" @update:model-value="view = $event" />
          </div>
          <div class="flex flex-col gap-1">
            <span class="text-[9px] font-semibold uppercase tracking-wide text-muted">Breakdown</span>
            <ControlToggleGroup :model-value="controls.byType" :options="BY_TYPE_OPTIONS" @update:model-value="updateControl('byType', $event)" />

          </div>
        </div>

        <div class="grid grid-cols-2 gap-4 items-stretch">
          <div class="flex flex-col gap-1">
            <span class="text-[9px] font-semibold uppercase tracking-wide text-muted">Y axis</span>
            <ControlToggleGroup :model-value="controls.yAxis" :options="Y_AXIS_OPTIONS" @update:model-value="updateControl('yAxis', $event)" />
          </div>
          <div class="flex flex-col gap-1">
            <span class="text-[9px] font-semibold uppercase tracking-wide text-muted">Scale</span>
            <ControlToggleGroup :model-value="controls.scale" :options="SCALE_OPTIONS" @update:model-value="updateControl('scale', $event)" />
          </div>
        </div>

        <!-- Per-type mode (Breakdown = Per type): 2-column type picker — Active
             left, Available (collapsed behind a chevron) right. No Fit selector
             here — the fit is a single FULL-graph curve with no common y-scale
             across per-type series, and a per-type re-fit would be statistically
             wrong (see report.md "Why no per-type fit overlay"). Median/IQR also
             hidden (N vertical lines = noise). -->
        <div v-if="controls.byType && availableTypes.length > 1" class="grid grid-cols-2 gap-3">
          <div class="flex flex-col gap-1 min-w-0">
            <!-- Bulk actions live next to "Active" — they act on the active set.
                 Blue to read as clickable (matches CentralityPanel). -->
            <div class="flex items-center justify-between gap-2">
              <span class="text-[9px] font-semibold uppercase tracking-wide text-muted">
                Active ({{ overlayTypes.length }})
              </span>
              <div class="flex items-center gap-2.5">
                <button
                  class="text-[10px] font-medium text-sky-700 hover:text-sky-900 disabled:opacity-30 disabled:hover:text-sky-700"
                  :disabled="overlayTypes.length === availableTypesSortedBySize.length"
                  @click="addAllOverlayTypes">Add all</button>
                <button
                  class="text-[10px] font-medium text-sky-700 hover:text-sky-900 disabled:opacity-30 disabled:hover:text-sky-700"
                  :disabled="overlayTypes.length === 0"
                  @click="removeAllOverlayTypes">Remove all</button>
              </div>
            </div>
            <div class="flex flex-wrap gap-1 max-h-44 overflow-y-auto pr-0.5">
              <button v-for="t in overlayTypes" :key="'a-'+t"
                class="type-chip px-1.5 py-0 text-[10px] inline-flex items-center gap-1"
                :style="{ backgroundColor: 'transparent', borderColor: activeColor(t), color: activeColor(t) }"
                @click="toggleOverlayType(t)">
                <svg width="12" height="12" viewBox="-7 -7 14 14" class="inline-block shrink-0">
                  <path :d="symbolPath(activeShape(t), 40)" fill="none"
                    :stroke="activeColor(t)" stroke-width="1.3" />
                </svg>
                {{ t }}
                <X :size="9" class="opacity-60" />
              </button>
              <span v-if="!overlayTypes.length" class="text-[10px] text-muted italic">No type active.</span>
            </div>
          </div>
          <div class="flex flex-col gap-1 min-w-0">
            <button
              class="flex items-center gap-1 text-[9px] font-semibold uppercase tracking-wide text-muted hover:text-secondary"
              :disabled="!inactiveOverlayTypes.length"
              :title="inactiveOverlayTypes.length ? (availableOpen ? 'Collapse' : 'Expand to add types') : 'All types active'"
              @click="availableOpen = !availableOpen"
            >
              <component :is="availableOpen ? ChevronDown : ChevronRight" :size="11" class="shrink-0" />
              <span>Available ({{ inactiveOverlayTypes.length }})</span>
            </button>
            <div v-if="availableOpen" class="flex flex-wrap gap-1 max-h-44 overflow-y-auto pr-0.5">
              <button v-for="t in inactiveOverlayTypes" :key="'i-'+t"
                class="type-chip px-1.5 py-0 text-[10px]"
                :style="{ borderColor: typeColor(t), color: typeColor(t) }"
                @click="toggleOverlayType(t)">{{ t }}</button>
              <span v-if="!inactiveOverlayTypes.length" class="text-[10px] text-muted italic">All types active.</span>
            </div>
          </div>
        </div>

        <!-- Total mode (Breakdown = Total): Overlay (median/iqr) + Fit selector. -->
        <div v-else class="grid grid-cols-2 gap-4">
          <div class="flex flex-col gap-1">
            <span class="text-[9px] font-semibold uppercase tracking-wide text-muted">Overlay</span>
            <div class="flex flex-col gap-1">
              <ControlBoolean label="Median" :model-value="controls.showMedian" @update:model-value="updateControl('showMedian', $event)" />
              <ControlBoolean label="IQR" :model-value="controls.showIqr" @update:model-value="updateControl('showIqr', $event)" />
            </div>
          </div>
          <div class="flex flex-col gap-1">
            <span
              class="text-[9px] font-semibold uppercase tracking-wide text-muted"
              title="Δ AIC per data point vs best fit (scale-invariant). < 0.01: indistinguishable; 0.01–0.1: modest difference; > 0.5: model ruled out."
            >Fit <span class="normal-case font-normal">(Δ AIC/n)</span></span>
            <div class="flex flex-col gap-1">
              <button
                v-for="s in fitSwitches" :key="s.name"
                class="flex items-center justify-between gap-2 text-[11px] transition"
                :class="fitActive === s.name ? 'text-primary' : 'text-muted hover:text-secondary'"
                @click="fitActive = fitActive === s.name ? null : s.name"
              >
                <span class="flex items-center gap-1.5">
                  <span
                    class="inline-block h-2 w-2 rounded-full border transition-colors"
                    :class="fitActive === s.name ? 'bg-slate-900 border-slate-900' : 'border-slate-400'"
                  />
                  <span>{{ s.label }}</span>
                </span>
                <span class="text-[10px] text-muted tabular-nums shrink-0">{{ formatDeltaAic(s.deltaAic) }}</span>
              </button>
            </div>
          </div>
        </div>

      </div>
    </Teleport>

    <!-- Interactive theory block teleported into PanelFocus's drawer. Inline
         links drive the panel's own controls so the reader can toggle overlays
         straight from the prose. -->
    <Teleport v-if="theoryTarget" :to="`#${theoryTarget}`">
      <div class="flex flex-col gap-4 text-sm leading-relaxed text-secondary">

        <section class="flex flex-col gap-2">
          <h3 class="text-xs font-semibold uppercase tracking-widest text-muted">Reading this plot</h3>
          <p>
            A node's <strong>degree</strong> is its number of connections. Each dot describes how many of
            <template v-if="theoryStats">the <strong>{{ FORMATTERS.integer(theoryStats.n) }} nodes</strong></template><template v-else>the nodes</template>
            have a specific degree <em>k</em><template v-if="theoryStats"> (x-axis, ranging from <strong>{{ theoryStats.min }}</strong> to <strong>{{ theoryStats.max }}</strong>)</template>.<template v-if="theoryStats && theoryStats.skewRatio">
              The distribution is <strong>{{ theoryStats.heavyTailed ? 'strongly skewed' : 'moderately concentrated' }}</strong>: the busiest node holds <strong>{{ FORMATTERS.integer(theoryStats.skewRatio) }}×</strong> the connections of the
              <button :class="theoryLinkClass(controls.showMedian)"
                @click="updateControl('showMedian', !controls.showMedian)">median</button>
              one (degree <strong>{{ FORMATTERS.integer(theoryStats.median) }}</strong>), the signature of a few hubs among many sparse nodes.</template>
          </p>
          <p>
            Read it as a
            <button :class="theoryLinkClass(view === 'PMF')"
              @click="view = 'PMF'">PMF</button>
            (<strong>Probability Mass Function</strong> — nodes of <em>exactly</em> degree <em>k</em>) or a
            <button :class="theoryLinkClass(view === 'CCDF')"
              @click="view = 'CCDF'">CCDF</button>
            (<strong>Complementary Cumulative Distribution Function</strong> — degree <em>≥ k</em>, which smooths the noisy tail). The Y axis shows a
            <button :class="theoryLinkClass(controls.yAxis === 'count')"
              @click="updateControl('yAxis', 'count')">count</button>
            or a
            <button :class="theoryLinkClass(controls.yAxis === 'probability')"
              @click="updateControl('yAxis', 'probability')">fraction</button>
            (a <strong>probability</strong>, for comparing graphs of different sizes).
          </p>
          <p v-if="hasMultipleTypes">
            To tell whether different kinds of node follow the same degree pattern or distinct ones, switch to the
            <button :class="theoryLinkClass(controls.byType)"
              @click="updateControl('byType', !controls.byType)">per-type</button>
            view: it splits the curve into one series per <strong>node type</strong>, each with its own shape and color.
          </p>
          <p v-if="manyTypes" class="rounded-md bg-slate-50 px-3 py-2 text-[13px] text-slate-700">
            <strong>Note:</strong> with <strong>{{ availableTypes.length }}</strong> node types the per-type view is too crowded to show them all, so only the {{ TOP_TYPES_DEFAULT }} largest start active. Open the panel <strong>settings</strong> (the controls icon at the top-right of the panel) to pick which types to display.
          </p>
        </section>

        <section class="flex flex-col gap-2">
          <h3 class="text-xs font-semibold uppercase tracking-widest text-muted">Fitting curve</h3>
          <p>
            Overlaying a theoretical model tells you which law generates the distribution. We compare four families with the <strong>AIC</strong> (<strong>Akaike Information Criterion</strong>),
            <span class="font-mono">−2·ln(L) + 2·k</span>, which rewards how well a model fits (its log-likelihood <span class="font-mono">L</span>) while penalizing how many free parameters <span class="font-mono">k</span> it uses. We report the gap from the winner as <strong>Δ AIC/n</strong> — normalized by graph size, so the best model reads 0.
          </p>
          <ul v-if="theoryFit" class="flex flex-col gap-1.5 pl-1">
            <li v-for="e in theoryFit.entries" :key="e.name"
              :class="{ 'text-primary font-medium': e.name === theoryFit.best.name }">
              <button :class="theoryLinkClass(fitActive === e.name)"
                @click="fitActive = fitActive === e.name ? null : e.name">{{ FIT_LABELS[e.name] }}</button>
              <span class="text-muted"> · Δ AIC/n = {{ formatDeltaAic(e.deltaAic) }}</span>
              <span v-if="e.name === theoryFit.best.name" class="text-emerald-600 font-medium"> ← best</span>
            </li>
          </ul>
          <p class="rounded-md bg-slate-50 px-3 py-2 text-[13px] text-slate-700">
            <strong>Note:</strong> a model within a <strong>Δ AIC/n of 0.01–0.1</strong> of the best is practically indistinguishable from it — picking between the two changes nothing. Values above <strong>0.5</strong> mean the model is clearly ruled out.
          </p>
        </section>

      </div>
    </Teleport>

    <div v-if="loading" class="text-sm text-secondary p-3 surface-recessed rounded-lg">Loading nodes…</div>
    <div v-if="error" class="text-sm text-red-600 p-3 bg-red-50 rounded-lg border border-red-200">{{ error }}</div>
    <p v-if="noNodesActive" class="text-[10px] italic text-amber-600 px-1">No data under current filters.</p>
    <div ref="chartContainer" class="chart-elev w-full" style="aspect-ratio: 4/3; position: relative;"></div>
  </div>
</template>
