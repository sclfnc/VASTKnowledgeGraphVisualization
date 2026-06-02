<script setup>
import { ref, watch, toRef, computed, nextTick } from 'vue'
import * as d3 from 'd3'
import Slider from '@vueform/slider'
import '@vueform/slider/themes/default.css'
import { useComponents } from '@/composables/useComponents.js'
import { injectGraphNodes } from '@/composables/useGraphNodes.js'
import { useNodeTypeColors } from '@/composables/useNodeTypeColors.js'
import { useEffectiveType } from '@/composables/useEffectiveType.js'
import { usePanelContextFromProps } from '@/composables/usePanelContext.js'
import { useSelectionStore } from '@/stores/selection.js'
import { useFiltersStore } from '@/stores/filters.js'
import { useFilterShortcuts } from '@/composables/useFilterShortcuts.js'
import { Bitset } from '@/utils/bitset.js'
import { makeTooltip, showTip, hideTip, FORMATTERS, theoryLinkClass, SLATE, COLOR_SCHEME } from './shared.js'
import { usePanel } from './usePanel.js'
import { useD3Chart } from './useD3Chart.js'
import ControlSection from './controls/ControlSection.vue'
import ControlToggleGroup from './controls/ControlToggleGroup.vue'

const props = defineProps({
  panelSpec: { type: Object, required: true },
  schema: { type: Object, default: null },
  graphId: { type: String, default: null },
  widened: { type: Boolean, default: false },
  expanded: { type: Boolean, default: false },
  controlsTarget: { type: String, default: null },
  // Set only when mounted inside PanelFocus (the theory modal). There the
  // grid's side-by-side widen isn't available, so the drill-down replaces the
  // main chart instead of sitting next to it.
  theoryTarget: { type: String, default: null },
})

const emit = defineEmits(['request-widen', 'request-shrink'])

const { data, loading, error } = useComponents(toRef(props, 'graphId'))
const { nodes: soa } = injectGraphNodes(toRef(props, 'graphId'))
const { color: typeColor } = useNodeTypeColors(toRef(props, 'schema'))
const { nodeTypeAt, nodeTypeList } = useEffectiveType(toRef(props, 'graphId'), toRef(props, 'schema'))
// The drill-down is a per-node-type breakdown; it only makes sense when the
// graph actually has ≥2 effective types. On a single-type graph a click is a
// plain selection broadcast — no widen, no one-bar drill-down.
const hasTypeDiversity = computed(() => (nodeTypeList.value?.length ?? 0) > 1)
// Mounted inside the theory modal? Then drill-down replaces the chart.
const inFocus = computed(() => props.theoryTarget != null)
const { activeNodeMask, selectedMask, noNodesActive } = usePanelContextFromProps(props)
const selection = useSelectionStore()
const filters = useFiltersStore()
const { filterToComponent, clearWccFilter } = useFilterShortcuts()
const { controls, updateControl } = usePanel(props, 'connectivity')
const mainContainer = ref(null)
const drillContainer = ref(null)
const selectedId = ref(null)

const sccAvailable = computed(() => !!data.value?.directed)
const activeMode = computed(() => (controls.value.mode === 'scc' && sccAvailable.value) ? 'scc' : 'wcc')
const activeSummary = computed(() => {
  const d = data.value
  if (!d) return null
  return activeMode.value === 'scc' ? d.scc : d.wcc
})

// Graph-level facts for the theory block (always read from the WCC summary —
// the narrative talks about overall connectivity).
const theoryStats = computed(() => {
  const wcc = data.value?.wcc
  if (!wcc) return null
  const total = props.schema?.nodes ?? 0
  const lccPct = total ? (wcc.lcc_size / total) * 100 : 0
  return {
    count: wcc.count,
    lccSize: wcc.lcc_size,
    lccPct,
    singletons: wcc.singletons,
    total,
  }
})

// component-id → Bitset of node indices; rebuilt O(N) per mode change.
const componentMasks = computed(() => {
  const s = soa.value
  if (!s) return null
  const ids = activeMode.value === 'scc' ? s.sccId : s.wccId
  if (!ids) return null
  const map = new Map()
  for (let i = 0; i < s.N; i++) {
    const cid = ids[i]
    if (cid < 0) continue
    let bs = map.get(cid)
    if (!bs) { bs = new Bitset(s.N); map.set(cid, bs) }
    bs.set(i)
  }
  return map
})

// popcount(componentMask AND activeNodeMask) — shrinks under filter; used in place of comp.size.
function activeSizeOf(comp) {
  const masks = componentMasks.value
  const act = activeNodeMask.value
  if (!masks || !act) return comp.size
  const cm = masks.get(comp.id)
  if (!cm) return 0
  const tmp = cm.clone()
  tmp.andInPlace(act)
  return tmp.popcount()
}

function selectedCountOf(comp) {
  const masks = componentMasks.value
  const sel = selectedMask.value
  if (!masks || !sel) return 0
  const cm = masks.get(comp.id)
  if (!cm) return 0
  const tmp = cm.clone()
  tmp.andInPlace(sel)
  return tmp.popcount()
}

// True when a cross-panel selection exists at all.
const hasSelection = computed(() => (selectedMask.value?.popcount() ?? 0) > 0)

// Mark opacity unifies two dimming reasons (area stays the data — we never
// scale it for selection): a drill-down focus dims the non-focused components,
// and a cross-panel selection dims components that hold no selected node. The
// component with focus / with selected nodes stays fully opaque.
function markOpacity(comp) {
  if (selectedId.value != null) return selectedId.value === comp.id ? 1 : 0.3
  if (hasSelection.value) return selectedCountOf(comp) > 0 ? 1 : 0.45
  return 1
}

function activeIdsOf(comp) {
  const masks = componentMasks.value
  const act = activeNodeMask.value
  const s = soa.value
  if (!masks || !s) return []
  const cm = masks.get(comp.id)
  if (!cm) return []
  const tmp = cm.clone()
  if (act) tmp.andInPlace(act)
  const out = []
  for (const idx of tmp) out.push(s.ids[idx])
  return out
}

// Active node ids of the given effective types within a component — backs the
// drill-down bar click (broadcasts the selection of "type T in this component").
// `wantTypes` is a Set of effective labels; "Other" passes all the folded ones.
function idsOfTypesInComponent(comp, wantTypes) {
  const masks = componentMasks.value
  const act = activeNodeMask.value
  const s = soa.value
  if (!masks || !s) return []
  const cm = masks.get(comp.id)
  if (!cm) return []
  const tmp = cm.clone()
  if (act) tmp.andInPlace(act)
  const out = []
  for (const idx of tmp) {
    if (wantTypes.has(nodeTypeAt(idx))) out.push(s.ids[idx])
  }
  return out
}

function activeByTypeOf(comp) {
  const masks = componentMasks.value
  const act = activeNodeMask.value
  const s = soa.value
  // Re-aggregate via SoA + nodeTypeAt so the drill-down uses the effective
  // type (auto-promoted attr or raw `Node Type`).
  if (!masks || !s) {
    if (!s) return comp.by_type
    const cm = (componentMasks.value || new Map()).get(comp.id)
    if (!cm) return comp.by_type
    const out = {}
    for (const idx of cm) {
      const t = nodeTypeAt(idx)
      out[t] = (out[t] || 0) + 1
    }
    return out
  }
  const cm = masks.get(comp.id)
  if (!cm) return {}
  const tmp = cm.clone()
  if (act) tmp.andInPlace(act)
  const out = {}
  for (const idx of tmp) {
    const t = nodeTypeAt(idx)
    out[t] = (out[t] || 0) + 1
  }
  return out
}

// Rank filter is meaningless with a single component.
const componentCount = computed(() => activeSummary.value?.count ?? 0)
const filterAvailable = computed(() => componentCount.value > 1)

// Single-component graph (typically a connected graph: one WCC covering ~100%):
// a lone bubble/bar carries no comparative information. We swap the chart for an
// explanatory empty-state instead. `null` until data loads so we don't flash it.
const singleComponent = computed(() => {
  const s = activeSummary.value
  if (!s || s.count !== 1) return null
  const comp = s.components?.[0]
  if (!comp) return null
  const total = props.schema?.nodes ?? comp.size
  const pct = total ? (comp.size / total) * 100 : 100
  return { size: comp.size, total, pct }
})

// All components for the active mode, always drawn (mask-only contract: the
// rank filter doesn't hide marks locally — it writes filters.wccFilter, and
// components whose nodes fall outside the resulting mask attenuate to 0-active).
const displayedComponents = computed(() => activeSummary.value?.components ?? [])

// Distinct component sizes, descending — the rank operates on these, not on
// array positions, so tied components share one rank (e.g. 200 singletons all
// sit at the same "smallest size" rank and enter/leave the filter together).
const distinctSizesDesc = computed(() => {
  const comps = displayedComponents.value
  return [...new Set(comps.map(c => c.size))].sort((a, b) => b - a)
})

// Number of distinct size groups — the rank axis runs 1..rankCount (rank 1 =
// largest group). Ties share a rank: all 200 singletons sit at the same rank.
const rankCount = computed(() => distinctSizesDesc.value.length)

// The active size-rank window, clamped to [1, rankCount]. Defaults to the full
// span (whole range = no narrowing) when the control is null.
const rankRange = computed(() => {
  const r = controls.value.rankRange
  const n = rankCount.value
  if (!Array.isArray(r) || n === 0) return [1, n]
  const lo = Math.max(1, Math.min(n, r[0]))
  const hi = Math.max(lo, Math.min(n, r[1]))
  return [lo, hi]
})

// A rank window narrows only when it is not the full [1, rankCount] span.
const filterActive = computed(() => {
  const [lo, hi] = rankRange.value
  return rankCount.value > 0 && (lo > 1 || hi < rankCount.value)
})

// Translate the size-rank window into the explicit component-id list the scoped
// component-filter slot expects. Ranks are 1-based over distinct sizes desc, so
// [loRank, hiRank] keeps every component whose size sits in that rank band.
// Returns null when the window spans everything (no narrowing). applyRankFilter
// tags the ids with activeMode (wcc/scc) so useFilteredModel resolves them
// against the matching membership array — rank works in both modes.
function rankToComponentIds() {
  if (!filterActive.value) return null
  const sizes = distinctSizesDesc.value
  const [lo, hi] = rankRange.value
  const keepSizes = new Set(sizes.slice(lo - 1, hi))  // ranks are 1-based
  const ids = []
  for (const c of displayedComponents.value) {
    if (keepSizes.has(c.size)) ids.push(c.id)
  }
  return ids
}

// How many components survive the current rank filter, over the total. Drives
// the "X / Y shown" counter so the user sees how many the rank drops.
const shownCount = computed(() => {
  const total = displayedComponents.value.length
  const ids = rankToComponentIds()
  return { shown: ids == null ? total : ids.length, total }
})

// Plain-language summary of the active window: rank span + node + component
// totals, so the slider's meaning is explicit ("#1–#3 largest · 3 groups,
// 1,247 nodes, 5 components").
const rankSummary = computed(() => {
  const [lo, hi] = rankRange.value
  const ids = rankToComponentIds()
  const comps = displayedComponents.value
  const kept = ids == null ? comps : comps.filter(c => ids.includes(c.id))
  const nodes = kept.reduce((s, c) => s + c.size, 0)
  const groups = hi - lo + 1
  return { lo, hi, groups, nodes, components: kept.length }
})

// Push the current rank window into the global filter. Called on every change so
// "see fewer components here" == "filter the whole dashboard". The scope tags
// which membership array the mask resolves against (WCC vs SCC ids).
function applyRankFilter() {
  const ids = rankToComponentIds()
  if (ids == null) clearWccFilter()
  else filters.wccFilter = { scope: activeMode.value, ids: [...new Set(ids)].sort((a, b) => a - b) }
}

function setRankRange(value) {
  updateControl('rankRange', Array.isArray(value) ? [value[0], value[1]] : null)
  applyRankFilter()
}

function clearFilter() {
  updateControl('rankRange', null)
  clearWccFilter()
}


const selectedComponent = computed(() => {
  if (selectedId.value == null) return null
  return displayedComponents.value.find(c => c.id === selectedId.value) ?? null
})

const MARGINS = { top: 8, right: 12, bottom: 28, left: 44 }

const VIEW_OPTIONS = [{ k: 'bubbles', label: 'Bubbles' }, { k: 'bars', label: 'Bars' }]
// SCC is only meaningful on directed graphs. On an undirected graph WCC ≡ SCC,
// so we drop the toggle entirely (a disabled pill invites a dead click) and show
// a one-line note in its place — WCC is the only partitioning that applies.
const modeOptions = computed(() => [
  { k: 'wcc', label: 'WCC' },
  { k: 'scc', label: 'SCC' },
])

// Open the LCC's by-type breakdown from a link in the theory text. Selecting
// the largest component (size-desc → components[0]) switches the focus chart to
// its drill-down. Doesn't broadcast a selection — it's a local example view.
function showLccBreakdown() {
  const lcc = data.value?.wcc?.components?.[0]
  if (lcc) selectedId.value = lcc.id
}

// Theory-text control links (view / type): in the focus modal these should also
// leave the LCC breakdown and return to the overview, so the user isn't stuck
// looking at a drill-down while toggling bubbles/bars/WCC/SCC.
function theorySetControl(field, value) {
  if (inFocus.value) selectedId.value = null
  updateControl(field, value)
}

// Mode switch (WCC↔SCC): component ids are not comparable across the two
// partitionings, so reset the selection and any rank window to avoid a stale
// filter pointing at ids from the other mode.
watch(() => activeMode.value, () => {
  selectedId.value = null
  if (controls.value.rankRange != null) {
    updateControl('rankRange', null)
    clearWccFilter()
  }
})
watch(displayedComponents, (list) => {
  if (selectedId.value != null && !list.find(c => c.id === selectedId.value)) {
    selectedId.value = null
  }
})

// Widen (and the side-by-side drill-down it reveals) only on type-diverse
// graphs, and only in the dashboard grid. In the theory modal (inFocus) the
// drill replaces the chart instead, so we don't emit widen there.
watch(selectedId, (val) => {
  if (inFocus.value) return
  if ((val == null || !hasTypeDiversity.value) && props.widened) emit('request-shrink')
  if (val != null && hasTypeDiversity.value && !props.widened) emit('request-widen')
})

function renderAll() { renderMain(); renderDrill() }

watch([data, controls, () => props.widened, activeNodeMask, selectedMask, componentMasks], () => nextTick(renderAll), { deep: true })
// selectedComponent change re-renders: the side drill in the grid, the main
// chart (drill-as-replacement) in the focus modal.
watch(selectedComponent, () => nextTick(inFocus.value ? renderMain : renderDrill))

useD3Chart([mainContainer, drillContainer], renderAll, () => [props.widened, props.expanded])

// No cap: a capped broadcast would be a misleading selection (an arbitrary
// 500-node subset that drifts away from the chart once a filter changes the
// active set). Consumers read `selectedMask` (a Bitset over N), so the cost is
// the id-array length, not a per-mark loop — fine even for a 17k-node LCC.
function clickComponent(comp) {
  if (selectedId.value === comp.id) {
    selectedId.value = null
    selection.clear()
    return
  }
  selectedId.value = comp.id
  selection.replace(activeIdsOf(comp))
}

// Active size keeps labels coherent with bubble area; comp.size stays in the tooltip.
// Single combined label "N (pct%)". `compact` (used in narrow bubbles) shows
// the percentage alone — more telling than a raw count in a small mark; the
// tooltip always carries both.
function formatLabel(comp, total, compact = false) {
  const n = comp._active ?? activeSizeOf(comp)
  const pct = total ? (n / total) * 100 : 0
  const pctStr = pct < 0.1 ? '<0.1%' : `${pct.toFixed(1)}%`
  if (compact) return pctStr
  return `${n.toLocaleString()} (${pctStr})`
}

function tooltipHtml(comp, total) {
  const n = comp._active ?? activeSizeOf(comp)
  const pct = total ? ((n / total) * 100).toFixed(2) : '?'
  const head = `<strong>${activeMode.value.toUpperCase()} #${comp.id + 1}</strong>`
  const body = (n !== comp.size)
    ? `${n.toLocaleString()} / ${comp.size.toLocaleString()} nodes (${pct}%)`
    : `${comp.size.toLocaleString()} nodes (${pct}%)`
  return `${head}<br>${body}`
}

function renderMain() {
  if (!mainContainer.value) return
  d3.select(mainContainer.value).selectAll('*').remove()

  // In the theory modal, a selected component replaces the chart with its
  // by-type drill-down (no room to sit side-by-side as in the dashboard grid).
  if (inFocus.value && selectedComponent.value && hasTypeDiversity.value) {
    renderDrill(mainContainer.value)
    return
  }

  const comps = displayedComponents.value
  if (!comps.length) return

  const totalW = mainContainer.value.clientWidth || 400
  const totalH = mainContainer.value.clientHeight || Math.round(totalW * 3 / 4)

  if (controls.value.view === 'bubbles') {
    renderBubbles(mainContainer.value, totalW, totalH, comps)
  } else {
    renderBars(mainContainer.value, totalW, totalH, comps)
  }
}

function renderBubbles(container, totalW, totalH, comps) {
  const totalNodes = props.schema?.nodes ?? d3.sum(comps, c => c.size)
  // Pack by active size; drop zero-active components (would collapse to 0-radius leaves).
  const sized = comps.map(c => ({ ...c, _active: activeSizeOf(c) })).filter(c => c._active > 0)
  if (!sized.length) return
  const root = d3.hierarchy({ children: sized.map(c => ({ ...c, value: c._active })) })
    .sum(d => d.value)
    .sort((a, b) => b.value - a.value)

  d3.pack().size([totalW, totalH]).padding(4)(root)

  const svg = d3.select(container).append('svg').attr('width', totalW).attr('height', totalH)
  const g = svg.append('g')
  const tooltip = makeTooltip(container)

  const leaves = root.leaves()
  const maxSize = d3.max(sized, c => c._active) || 1
  // Sky palette mid-tone matches COLOR_SCHEME.accent (sky-600) used by other panels.
  const colorScale = d3.scaleSequential(d3.interpolateLab(COLOR_SCHEME.accentPale, COLOR_SCHEME.accentDark)).domain([0, Math.log10(maxSize + 1)])

  // Three label tiers by bubble radius: combined "N (pct%)" needs the most room;
  // below that show the percentage alone (compact); below that, no label (the
  // tooltip still surfaces everything).
  const labelRadiusThreshold = 14   // min radius to show any label
  const combinedRadiusThreshold = 26 // min radius to fit "N (pct%)"

  const node = g.selectAll('g').data(leaves).join('g')
    .attr('transform', d => `translate(${d.x},${d.y})`)
    .style('cursor', 'pointer')
    .on('click', (_, d) => clickComponent(d.data))
    .on('dblclick', (ev, d) => { ev.stopPropagation(); filterToComponent(d.data.id, activeMode.value) })
    .on('mouseover', (ev, d) => showTip(tooltip, ev, tooltipHtml(d.data, totalNodes)))
    .on('mousemove', (ev) => showTip(tooltip, ev, null))
    .on('mouseout', () => hideTip(tooltip))

  node.append('circle')
    .attr('r', d => d.r)
    .attr('fill', d => colorScale(Math.log10(d.data._active + 1)))
    .attr('stroke', d => selectedId.value === d.data.id ? SLATE[900] : '#fff')
    .attr('stroke-width', 1)
    .attr('opacity', d => markOpacity(d.data))

  // Rank "#k" rendered above the value label when the bubble fits two lines.
  const rankRadiusThreshold = labelRadiusThreshold + 12

  const labelGroup = node.filter(d => d.r >= labelRadiusThreshold)
    .append('g')
    .attr('pointer-events', 'none')

  labelGroup.filter(d => d.r >= rankRadiusThreshold)
    .append('text')
    .attr('text-anchor', 'middle')
    .attr('dy', '-0.4em')
    .attr('font-size', d => Math.min(d.r * 0.35, 12))
    .attr('font-weight', '500')
    .attr('fill', d => d.data._active > maxSize / 4 ? 'rgba(255,255,255,0.8)' : SLATE[500])
    .text(d => `#${comps.findIndex(c => c.id === d.data.id) + 1}`)

  labelGroup.append('text')
    .attr('text-anchor', 'middle')
    .attr('dy', d => d.r >= rankRadiusThreshold ? '0.85em' : '0.35em')
    .attr('font-size', d => Math.min(d.r * 0.45, 14))
    .attr('font-weight', '600')
    .attr('fill', d => d.data._active > maxSize / 4 ? '#fff' : SLATE[800])
    .text(d => formatLabel(d.data, totalNodes, d.r < combinedRadiusThreshold))
}

function renderBars(container, totalW, totalH, comps) {
  const totalNodes = props.schema?.nodes ?? d3.sum(comps, c => c.size)
  const innerW = Math.max(0, totalW - MARGINS.left - MARGINS.right)
  const innerH = Math.max(0, totalH - MARGINS.top - MARGINS.bottom)
  if (innerW < 50 || innerH < 50) return

  const svg = d3.select(container).append('svg').attr('width', totalW).attr('height', totalH)
  const g = svg.append('g').attr('transform', `translate(${MARGINS.left},${MARGINS.top})`)
  const tooltip = makeTooltip(container)

  // Render every displayed component (even 0-active) to make the filter effect explicit.
  comps = comps.map(c => ({ ...c, _active: activeSizeOf(c) }))

  // Component sizes are heavy-tailed (one giant LCC, many small): a log X axis
  // is the only readable choice, so it's fixed (no toggle).
  const minSize = d3.min(comps, c => Math.max(1, c._active)) || 1
  const maxSize = d3.max(comps, c => c._active) || 1

  const xScale = d3.scaleLog().domain([Math.max(1, minSize), maxSize]).range([0, innerW]).clamp(true)

  const yScale = d3.scaleBand()
    .domain(comps.map((_, i) => i))
    .range([0, innerH])
    .padding(0.15)

  const maxLabels = 12
  const step = Math.max(1, Math.ceil(comps.length / maxLabels))
  const yAxis = d3.axisLeft(yScale)
    .tickValues(comps.map((_, i) => i).filter(i => i % step === 0))
    .tickFormat(i => `#${i + 1}`)
  g.append('g').call(yAxis)
    .selectAll('text').attr('font-size', 10).attr('fill', SLATE[500])

  const xAxis = d3.axisBottom(xScale).ticks(5, '~s')
  g.append('g').attr('transform', `translate(0,${innerH})`).call(xAxis)
    .selectAll('text').attr('font-size', 10).attr('fill', SLATE[500])

  svg.append('text')
    .attr('x', MARGINS.left + innerW / 2).attr('y', totalH - 4)
    .attr('text-anchor', 'middle').attr('font-size', 11).attr('fill', SLATE[600])
    .text('Component size')

  // Sky palette mid-tone matches COLOR_SCHEME.accent (sky-600) used by other panels.
  const colorScale = d3.scaleSequential(d3.interpolateLab(COLOR_SCHEME.accentPale, COLOR_SCHEME.accentDark)).domain([0, Math.log10(maxSize + 1)])

  // Skip text label when the band is shorter than this; tooltip still works.
  const minBandForLabel = 12

  g.selectAll('rect.bar').data(comps).join('rect')
    .attr('class', 'bar')
    .attr('x', 0)
    .attr('y', (_, i) => yScale(i))
    .attr('width', d => xScale(Math.max(1, d._active)))
    .attr('height', yScale.bandwidth())
    .attr('fill', d => colorScale(Math.log10(d._active + 1)))
    .attr('stroke', d => selectedId.value === d.id ? SLATE[900] : 'none')
    .attr('stroke-width', d => selectedId.value === d.id ? 1 : 0)
    .attr('opacity', d => markOpacity(d))
    .style('cursor', 'pointer')
    .on('click', (_, d) => clickComponent(d))
    .on('dblclick', (ev, d) => { ev.stopPropagation(); filterToComponent(d.id, activeMode.value) })
    .on('mouseover', (ev, d) => showTip(tooltip, ev, tooltipHtml(d, totalNodes)))
    .on('mousemove', (ev) => showTip(tooltip, ev, null))
    .on('mouseout', () => hideTip(tooltip))

  if (yScale.bandwidth() >= minBandForLabel) {
    g.selectAll('text.size').data(comps).join('text')
      .attr('class', 'size')
      .attr('x', d => xScale(Math.max(1, d._active)) + 4)
      .attr('y', (_, i) => yScale(i) + yScale.bandwidth() / 2)
      .attr('dy', '0.35em')
      .attr('font-size', 10).attr('fill', SLATE[600]).attr('pointer-events', 'none')
      .text(d => formatLabel(d, totalNodes))
  }
}

function renderDrill(container = drillContainer.value) {
  if (!container || !selectedComponent.value) return
  d3.select(container).selectAll('*').remove()

  const comp = selectedComponent.value
  // Active-subset by_type keeps the drill-down coherent with bubble/bar size.
  const byType = activeByTypeOf(comp)
  const sorted = Object.entries(byType).sort((a, b) => b[1] - a[1])
  if (!sorted.length) return
  // Cap at the 10 most-present types; fold the rest into one "Other (k)" bar so
  // the chart stays readable on high-arity graphs while bars still sum to size.
  // `barTypes` maps each bar label → the set of effective types it represents
  // (one for a normal bar, the folded tail for "Other"), used on bar click.
  const DRILL_TOP = 10
  const OTHER_LABEL_PREFIX = 'Other ('
  let entries = sorted
  const barTypes = new Map(sorted.map(([t]) => [t, new Set([t])]))
  if (sorted.length > DRILL_TOP) {
    const head = sorted.slice(0, DRILL_TOP)
    const tail = sorted.slice(DRILL_TOP)
    const otherTotal = tail.reduce((s, [, n]) => s + n, 0)
    const otherLabel = `Other (${tail.length})`
    entries = [...head, [otherLabel, otherTotal]]
    barTypes.set(otherLabel, new Set(tail.map(([t]) => t)))
  }

  const totalW = container.clientWidth || 400
  const totalH = container.clientHeight || 300

  // Left margin grows with the longest type label (≤100px); right reserves count text room.
  const maxLabelChars = Math.max(...entries.map(([t]) => t.length))
  const margins = {
    top: 8,
    right: 50,
    bottom: 28,
    left: Math.min(100, Math.max(40, maxLabelChars * 6 + 10)),
  }
  const innerW = Math.max(50, totalW - margins.left - margins.right)
  const innerH = Math.max(30, totalH - margins.top - margins.bottom)

  const svg = d3.select(container).append('svg').attr('width', totalW).attr('height', totalH)
  const g = svg.append('g').attr('transform', `translate(${margins.left},${margins.top})`)

  const maxCount = d3.max(entries, d => d[1]) || 1
  const xScale = d3.scaleLinear().domain([0, maxCount]).range([0, innerW])
  const yScale = d3.scaleBand().domain(entries.map(d => d[0])).range([0, innerH]).padding(0.2)

  g.append('g').call(d3.axisLeft(yScale))
    .selectAll('text').attr('font-size', 10).attr('fill', SLATE[500])
  g.append('g').attr('transform', `translate(0,${innerH})`)
    .call(d3.axisBottom(xScale).ticks(4, '~s'))
    .selectAll('text').attr('font-size', 10).attr('fill', SLATE[500])

  svg.append('text')
    .attr('x', margins.left + innerW / 2).attr('y', totalH - 4)
    .attr('text-anchor', 'middle').attr('font-size', 11).attr('fill', SLATE[600])
    .text('Node count')

  const drillTip = makeTooltip(container)
  g.selectAll('rect').data(entries).join('rect')
    .attr('x', 0).attr('y', d => yScale(d[0]))
    .attr('width', d => xScale(d[1]))
    .attr('height', yScale.bandwidth())
    .attr('fill', d => d[0].startsWith(OTHER_LABEL_PREFIX) ? SLATE[400] : typeColor(d[0]))
    .attr('opacity', 0.85)
    .style('cursor', 'pointer')
    .on('mouseover', (ev, d) => showTip(drillTip, ev, `<strong>${d[0]}</strong><br>${d[1].toLocaleString()} nodes in this component`))
    .on('mousemove', (ev) => showTip(drillTip, ev, null))
    .on('mouseout', () => hideTip(drillTip))
    .on('click', (_, d) => {
      const ids = idsOfTypesInComponent(comp, barTypes.get(d[0]) ?? new Set([d[0]]))
      selection.replace(ids)
    })

  // Count goes after the bar if there's room, else inside (right-aligned, white).
  const labelGap = 4
  const isInside = d => xScale(d[1]) > innerW - 30
  g.selectAll('text.count').data(entries).join('text')
    .attr('class', 'count')
    .attr('x', d => isInside(d) ? xScale(d[1]) - labelGap : xScale(d[1]) + labelGap)
    .attr('y', d => yScale(d[0]) + yScale.bandwidth() / 2)
    .attr('dy', '0.35em')
    .attr('text-anchor', d => isInside(d) ? 'end' : 'start')
    .attr('font-size', 10)
    .attr('fill', d => isInside(d) ? '#fff' : SLATE[600])
    .attr('pointer-events', 'none')
    .text(d => d[1].toLocaleString())
}

</script>

<template>
  <div class="flex flex-col gap-1.5">
    <Teleport v-if="controlsTarget" :to="`#${controlsTarget}`">
      <div class="grid grid-cols-2 auto-rows-min gap-1.5">
        <ControlSection title="Style">
          <ControlToggleGroup :model-value="controls.view" :options="VIEW_OPTIONS" @update:model-value="updateControl('view', $event)" />
        </ControlSection>

        <ControlSection title="Type">
          <ControlToggleGroup
            v-if="sccAvailable"
            :model-value="controls.mode" :options="modeOptions"
            @update:model-value="updateControl('mode', $event)" />
          <p v-else class="text-[10px] leading-tight text-muted px-1">
            The graph is undirected, so only <strong>weakly-connected components</strong> apply (SCC ≡ WCC).
          </p>
        </ControlSection>

        <ControlSection v-if="filterAvailable" title="Filter by rank" :col-span="2">
          <template #actions>
            <div class="flex items-center gap-2">
              <span class="text-[10px] tabular-nums" :class="shownCount.shown < shownCount.total ? 'text-sky-700 font-medium' : 'text-muted'">
                {{ shownCount.shown.toLocaleString() }} / {{ shownCount.total.toLocaleString() }} shown
              </span>
              <button
                v-if="filterActive || filters.wccFilter"
                class="text-[10px] text-muted hover:text-red-400"
                @click="clearFilter"
              >clear</button>
            </div>
          </template>

          <!-- Size-rank window. Dual-handle slider over the distinct size groups
               (rank 1 = largest), styled like the degree filter: two editable
               number inputs flanking the slider. Writes the scoped global
               component filter ({ scope, ids }), so it works in both WCC and SCC
               mode — the ids resolve against the matching membership array. -->
          <div class="flex flex-col gap-1.5 px-1">
            <div class="flex items-center gap-1.5">
              <input
                type="number" :min="1" :max="rankCount"
                :value="rankRange[0]"
                class="input-base no-spin w-9 px-0.5 py-0 text-[10px] leading-tight tabular-nums text-center"
                @change="setRankRange([Math.max(1, Number($event.target.value)), rankRange[1]])"
              />
              <div class="flex-1 px-1">
                <Slider
                  :model-value="rankRange"
                  :min="1" :max="Math.max(1, rankCount)" :step="1"
                  :tooltips="false"
                  @update="setRankRange($event)"
                />
              </div>
              <input
                type="number" :min="1" :max="rankCount"
                :value="rankRange[1]"
                class="input-base no-spin w-9 px-0.5 py-0 text-[10px] leading-tight tabular-nums text-center"
                @change="setRankRange([rankRange[0], Math.min(rankCount, Number($event.target.value))])"
              />
            </div>
            <!-- Plain-language readout: which ranks, how many groups / nodes /
                 components survive. Makes the slider's meaning explicit. -->
            <p class="text-[10px] leading-tight" :class="filterActive ? 'text-sky-700' : 'text-muted'">
              <template v-if="rankSummary.lo === rankSummary.hi">
                Keeping the <strong>#{{ rankSummary.lo }}</strong> {{ rankSummary.lo === 1 ? 'largest' : (rankSummary.lo === rankCount ? 'smallest' : '') }} {{ activeMode.toUpperCase() }} size group
              </template>
              <template v-else>
                Keeping {{ activeMode.toUpperCase() }} size ranks <strong>#{{ rankSummary.lo }}–#{{ rankSummary.hi }}</strong> ({{ rankSummary.lo === 1 ? 'largest' : 'rank ' + rankSummary.lo }} → {{ rankSummary.hi === rankCount ? 'smallest' : 'rank ' + rankSummary.hi }})
              </template>
              · {{ rankSummary.components.toLocaleString() }} component{{ rankSummary.components === 1 ? '' : 's' }}, {{ FORMATTERS.integer(rankSummary.nodes) }} nodes.
              <span class="text-muted">Ties share a rank.</span>
            </p>
          </div>
        </ControlSection>
      </div>
    </Teleport>

    <!-- Interactive theory block teleported into PanelFocus's drawer. Inline
         links drive the panel's own controls so the reader can switch view /
         component type straight from the prose. -->
    <Teleport v-if="theoryTarget" :to="`#${theoryTarget}`">
      <div class="flex flex-col gap-4 text-sm leading-relaxed text-secondary">

        <section class="flex flex-col gap-2">
          <h3 class="text-xs font-semibold uppercase tracking-widest text-muted">Reading this plot</h3>
          <p>
            A <strong>connected component</strong> is a group of nodes reachable from one another. Each bubble (or bar) is one component and its <strong>area</strong> (or length) is how many nodes it holds. Real networks usually have one <strong>giant component</strong> covering almost everything, plus many small or isolated ones.<template v-if="theoryStats">
              Here there {{ theoryStats.count === 1 ? 'is' : 'are' }} <strong>{{ FORMATTERS.integer(theoryStats.count) }}</strong> component{{ theoryStats.count === 1 ? '' : 's' }}: the largest holds <strong>{{ FORMATTERS.integer(theoryStats.lccSize) }}</strong> nodes (<strong>{{ theoryStats.lccPct < 0.1 ? '<0.1' : theoryStats.lccPct.toFixed(1) }}%</strong>), and <strong>{{ FORMATTERS.integer(theoryStats.singletons) }}</strong> {{ theoryStats.singletons === 1 ? 'node sits' : 'nodes sit' }} alone.</template>
          </p>
          <p>
            View it as
            <button :class="theoryLinkClass(controls.view === 'bubbles' && !selectedId)"
              @click="theorySetControl('view', 'bubbles')">bubbles</button>
            or
            <button :class="theoryLinkClass(controls.view === 'bars' && !selectedId)"
              @click="theorySetControl('view', 'bars')">bars</button>.<template v-if="sccAvailable">
              On this directed graph you can also switch between
              <button :class="theoryLinkClass(controls.mode === 'wcc')"
                @click="theorySetControl('mode', 'wcc')">WCC</button>
              (ignores edge direction) and
              <button :class="theoryLinkClass(controls.mode === 'scc')"
                @click="theorySetControl('mode', 'scc')">SCC</button>
              (needs a directed path both ways — smaller, stricter groups).</template>
            <template v-if="hasTypeDiversity">
              Click any component to break it down by <strong>node type</strong> — for example,
              <button :class="theoryLinkClass(selectedId === (data?.wcc?.components?.[0]?.id ?? -1))"
                @click="showLccBreakdown()">see the largest one</button>.
            </template>
          </p>
        </section>

        <section v-if="filterAvailable" class="flex flex-col gap-2">
          <h3 class="text-xs font-semibold uppercase tracking-widest text-muted">Filtering</h3>
          <p>
            The rank slider keeps a window of <strong>size ranks</strong>: rank #1 is the largest component, and components of equal size share one rank. Drag the two handles to keep a band — <strong>#1–#3</strong> for the three largest, the right end alone for the smallest. It's a global filter — those nodes are hidden across the whole dashboard, not just here.
          </p>
        </section>

      </div>
    </Teleport>

    <div v-if="loading" class="text-sm text-secondary p-3 surface-recessed rounded-lg">Loading components…</div>
    <div v-if="error" class="text-sm text-red-600 p-3 bg-red-50 rounded-lg border border-red-200">{{ error }}</div>
    <p v-if="noNodesActive" class="text-[10px] italic text-amber-600 px-1">No data under current filters.</p>

    <!-- Focus modal: a back affordance to leave the by-type drill (which
         replaced the chart) and return to the component overview. -->
    <button
      v-if="inFocus && selectedComponent && hasTypeDiversity"
      class="self-start text-[11px] text-sky-700 hover:text-sky-900 px-1"
      @click="clickComponent(selectedComponent)">
      ← Back to components
    </button>

    <!-- Single-component graph: one bubble carries no comparison, so we explain
         the graph is connected instead of drawing a lone mark. -->
    <div
      v-if="!loading && !error && singleComponent"
      class="chart-elev flex w-full flex-col items-center justify-center gap-2 px-6 text-center"
      style="aspect-ratio: 4/3;"
    >
      <p class="text-sm font-medium text-primary">
        The graph is {{ singleComponent.pct >= 99.95 ? 'connected' : 'essentially connected' }}.
      </p>
      <p class="text-xs text-secondary">
        A single {{ activeMode.toUpperCase() }} holds all
        <strong>{{ FORMATTERS.integer(singleComponent.size) }}</strong> nodes
        ({{ singleComponent.pct < 0.1 ? '<0.1' : singleComponent.pct.toFixed(1) }}%).
        There is no fragmentation to explore here.
      </p>
    </div>

    <div v-else :class="widened && selectedComponent ? 'grid grid-cols-2 gap-6' : ''">
      <div ref="mainContainer" class="chart-elev w-full min-w-0" style="aspect-ratio: 4/3; position: relative;"></div>
      <div v-if="widened && selectedComponent" class="flex flex-col min-w-0">
        <div ref="drillContainer" class="chart-elev w-full min-w-0 h-full" style="position: relative;"></div>
      </div>
    </div>


  </div>
</template>

<style scoped>
/* Hide native number-input spinners — the rank fields are typed/edited, the
   up/down arrows just waste width here. */
.no-spin::-webkit-outer-spin-button,
.no-spin::-webkit-inner-spin-button {
  -webkit-appearance: none;
  margin: 0;
}
.no-spin {
  -moz-appearance: textfield;
  appearance: textfield;
}
</style>
