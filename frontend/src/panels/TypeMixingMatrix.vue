<script setup>
import { ref, computed, toRef, watch, nextTick } from 'vue'
import * as d3 from 'd3'
import { Grid3x3 } from 'lucide-vue-next'
import { useTypeMixing } from '@/composables/useTypeMixing.js'
import { injectGraphNodes } from '@/composables/useGraphNodes.js'
import { injectGraphEdges } from '@/composables/useGraphEdges.js'
import { useNodeTypeColors } from '@/composables/useNodeTypeColors.js'
import { useEffectiveType } from '@/composables/useEffectiveType.js'
import { usePanelContextFromProps } from '@/composables/usePanelContext.js'
import { useSelectionStore, SELECTION_CAPS } from '@/stores/selection.js'
import { usePanel } from './usePanel.js'
import { useD3Chart } from './useD3Chart.js'
import { makeTooltip, showTip, hideTip, svgFrame, FORMATTERS, selectedTypesIn, idsOfTypesSoA, theoryLinkClass, effectiveTypeListOr, SLATE, COLOR_SCHEME } from './shared.js'
import ControlSection from './controls/ControlSection.vue'
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

const emit = defineEmits(['request-widen', 'request-shrink'])

const { data, loading, error } = useTypeMixing(toRef(props, 'graphId'))
const { nodes: nodesSoA } = injectGraphNodes(toRef(props, 'graphId'))
const { edges: edgesSoA } = injectGraphEdges(toRef(props, 'graphId'))
const { color: typeColor } = useNodeTypeColors(toRef(props, 'schema'))
const { nodeTypeAt, edgeTypeAt, nodeTypeList } = useEffectiveType(toRef(props, 'graphId'), toRef(props, 'schema'))
const { activeNodeMask, activeEdgeMask, selectedMask, edgeFilterActive, noNodesActive } = usePanelContextFromProps(props)
const selection = useSelectionStore()
const { controls, updateControl } = usePanel(props, 'type_mixing')

// Effective node types with ≥1 node in the current selection. A cell (t,u) is
// outlined when t or u is in this set (stays within the selection cap). Shared
// helper, same logic in EdgeFlow.
const selectedNodeTypes = computed(() =>
  selectedTypesIn(nodesSoA.value?.N ?? 0, selectedMask.value, nodeTypeAt))

const matrixContainer = ref(null)
const auxContainer = ref(null)
let tooltip = null

const SELECTION_CAP = SELECTION_CAPS.type_mixing
const MARGINS = { top: 78, right: 12, bottom: 14, left: 78 }

const MODE_OPTIONS = [
  { k: 'edges', label: 'Edges' },
  { k: 'nodes', label: 'Neighbors' },
]
const NORM_OPTIONS = [
  { k: 'none', label: 'None' },
  { k: 'row', label: 'Row' },
  { k: 'col', label: 'Col' },
]
const SORT_OPTIONS = [
  { k: 'volume', label: 'Volume' },
  { k: 'name', label: 'Name' },
]

// Rows/cols collapse to the visible set; Newman r stays anchored to the full graph.
// `nodeTypeList` returns the effective labels (auto-promoted) or raw types.
const allNodeTypes = computed(() => effectiveTypeListOr(nodeTypeList.value, data.value?.node_types))
const allEdgeTypes = computed(() => data.value?.edge_types || [])
// Contract: visible rows/cols come from the global masks, not from the raw
// filters.nodeTypes/edgeTypes chip arrays. A type is visible only if it has ≥1
// element that survives the mask — so degree/attr/wcc filters that empty a type
// drop its row, not just the type chip group. Effective-type aware via
// nodeTypeAt/edgeTypeAt.
const nodeTypes = computed(() => {
  const soa = nodesSoA.value
  const m = activeNodeMask.value
  if (!soa || !m) return allNodeTypes.value
  const present = new Set()
  for (let i = 0; i < soa.N; i++) if (m.get(i)) present.add(nodeTypeAt(i))
  return allNodeTypes.value.filter(t => present.has(t))
})
// One controls-independent walk over the active edges (re-runs only on
// edges/mask change): the present edge types AND the per-(src_type, edge_type,
// dst_type) counts that the 'edges' matrix is a cheap re-aggregation of — so
// mode and edge-type-filter toggles never re-scan the edges. Effective-type
// aware via nodeTypeAt/edgeTypeAt.
const edgeAgg = computed(() => {
  const soaE = edgesSoA.value
  const eMask = activeEdgeMask.value
  if (!soaE || !eMask) return null
  const present = new Set()
  const byTriple = new Map()  // st -> et -> dt -> count
  for (let i = 0; i < soaE.E; i++) {
    if (!eMask.get(i)) continue
    const et = edgeTypeAt(i)
    present.add(et)
    const st = nodeTypeAt(soaE.source[i])
    const dt = nodeTypeAt(soaE.target[i])
    let byEt = byTriple.get(st)
    if (!byEt) { byEt = new Map(); byTriple.set(st, byEt) }
    let byDt = byEt.get(et)
    if (!byDt) { byDt = new Map(); byEt.set(et, byDt) }
    byDt.set(dt, (byDt.get(dt) || 0) + 1)
  }
  return { present, byTriple }
})

// Visible edge types: those with ≥1 active edge (effective labels), in schema
// order. Falls back to the full list before the SoA/mask loads.
const edgeTypes = computed(() => {
  const agg = edgeAgg.value
  if (!agg) return allEdgeTypes.value
  return allEdgeTypes.value.filter(t => agg.present.has(t))
})

// Interaction volume per type (row+col sum on the raw matrix). Used to pick
// which types survive the cap, regardless of the chosen display order.
const typeVolume = computed(() => {
  const types = nodeTypes.value
  const M = activeMatrix.value
  const vol = new Map(types.map(t => [t, 0]))
  if (M) {
    for (const t of types) {
      for (const u of types) {
        const v = M[t]?.[u] || 0
        vol.set(t, vol.get(t) + v)
        if (u !== t) vol.set(u, vol.get(u) + v)
      }
    }
  }
  return vol
})

// The cap always keeps the top-N by volume (so important types aren't dropped),
// but the DISPLAY order follows the user's Sort choice: by volume (most-connected
// first) or by name (numeric-aware, so "Dept 2" precedes "Dept 10").
const orderedTypes = computed(() => {
  const types = nodeTypes.value
  if (!types.length) return { labels: [], hiddenCount: 0 }
  const vol = typeVolume.value
  const cap = Math.max(2, controls.value.maxTypes ?? 12)
  const kept = [...types].sort((a, b) => (vol.get(b) - vol.get(a)) || a.localeCompare(b)).slice(0, cap)
  const labels = controls.value.sort === 'name'
    ? kept.sort((a, b) => a.localeCompare(b, undefined, { numeric: true }))
    : kept.sort((a, b) => (vol.get(b) - vol.get(a)) || a.localeCompare(b))
  return { labels, hiddenCount: Math.max(0, types.length - cap) }
})

const hiddenCount = computed(() => orderedTypes.value.hiddenCount)

// Mixing matrix, derived client-side so the edge mask (type/weight/selfLoop)
// propagates uniformly. 'edges' mode is a cheap re-aggregation of the
// precomputed triple counts — no edge re-scan on mode/filter toggle. 'nodes'
// mode needs per-node identity for distinct-neighbor dedup, so it keeps its own
// walk over the active edges.
const activeMatrix = computed(() => {
  const agg = edgeAgg.value
  const soaN = nodesSoA.value
  if (!agg || !soaN) return null

  const types = allNodeTypes.value
  if (!types.length) return null

  const out = {}
  for (const t of types) {
    out[t] = {}
    for (const u of types) out[t][u] = 0
  }

  if (controls.value.mode === 'edges') {
    const filter = controls.value.edgeTypeFilter || null
    // Undirected → symmetric: each edge counts once per type pair, mirrored onto
    // both off-diagonal cells. Same-type edges (st === dt) land on the diagonal
    // and stay counted once (no double-add), so every cell reads as the literal
    // edge count between its two types.
    const directed = data.value?.directed ?? false
    for (const [st, byEt] of agg.byTriple) {
      if (!(st in out)) continue
      for (const [et, byDt] of byEt) {
        if (filter && et !== filter) continue
        for (const [dt, c] of byDt) {
          if (!(dt in out[st])) continue
          out[st][dt] += c
          if (!directed && st !== dt) out[dt][st] += c
        }
      }
    }
    return out
  }

  // 'nodes' mode: count distinct 1-hop neighbors per (src_type, dst_type).
  // Undirected → symmetric (each edge contributes to both src→dst and dst→src).
  const soaE = edgesSoA.value
  const eMask = activeEdgeMask.value
  const directed = data.value?.directed ?? false
  const reached = new Map()  // Map<srcType, Map<dstType, Set<nodeIdx>>>
  const add = (st, dt, nodeIdx) => {
    let row = reached.get(st)
    if (!row) { row = new Map(); reached.set(st, row) }
    let s = row.get(dt)
    if (!s) { s = new Set(); row.set(dt, s) }
    s.add(nodeIdx)
  }
  for (let i = 0; i < soaE.E; i++) {
    if (!eMask.get(i)) continue
    const srcIdx = soaE.source[i], dstIdx = soaE.target[i]
    const st = nodeTypeAt(srcIdx), dt = nodeTypeAt(dstIdx)
    add(st, dt, dstIdx)
    if (!directed) add(dt, st, srcIdx)
  }
  for (const [st, row] of reached) {
    if (!(st in out)) continue
    for (const [dt, s] of row) {
      if (dt in out[st]) out[st][dt] = s.size
    }
  }
  return out
})

// `visible` = rows/cols to emit (capped, ordered); `all` = the full type set
// used for the denominator, so a row/col total stays the TRUE total even when
// the cap hides some types (those cells just don't get drawn — the percentages
// don't fake summing to 100% over the visible subset).
function normalizeMatrix(M, visible, all, mode) {
  if (!M || mode === 'none') return M
  const denom = all && all.length ? all : visible
  const out = {}
  if (mode === 'row') {
    for (const t of visible) {
      const total = d3.sum(denom, u => M[t]?.[u] || 0)
      out[t] = {}
      for (const u of visible) {
        out[t][u] = total ? (M[t]?.[u] || 0) / total : 0
      }
    }
  } else {
    for (const t of visible) out[t] = {}
    for (const u of visible) {
      const total = d3.sum(denom, t => M[t]?.[u] || 0)
      for (const t of visible) {
        out[t][u] = total ? (M[t]?.[u] || 0) / total : 0
      }
    }
  }
  return out
}

// Normalize the visible (capped, volume-ordered) rows/cols, but with the
// denominator taken over ALL types — so percentages stay true even when the cap
// hides some types (their share is simply absent, not redistributed).
const displayMatrix = computed(() =>
  normalizeMatrix(activeMatrix.value, orderedTypes.value.labels, nodeTypes.value, controls.value.normalize))

const activeR = computed(() => {
  const a = data.value?.assortativity
  if (!a) return null
  if (controls.value.edgeTypeFilter && controls.value.mode === 'edges') {
    const v = a.per_edge_type?.[controls.value.edgeTypeFilter]
    return v == null ? null : v
  }
  return a.overall
})

function rBadgeClass(r) {
  if (r == null) return 'bg-slate-100 text-slate-500'
  if (r > 0.1) return 'bg-emerald-100 text-emerald-700'
  if (r < -0.1) return 'bg-rose-100 text-rose-700'
  return 'bg-slate-100 text-slate-600'
}

function renderMatrix() {
  if (!matrixContainer.value) return
  d3.select(matrixContainer.value).selectAll('*').remove()
  if (!data.value) return

  const types = orderedTypes.value.labels
  if (types.length < 2) return  // empty state handled in template

  const M = displayMatrix.value
  const M_raw = activeMatrix.value
  const { totalW, totalH, innerW, innerH } = svgFrame(matrixContainer.value, MARGINS, { minInner: 50 })

  const svg = d3.select(matrixContainer.value).append('svg')
    .attr('width', totalW).attr('height', totalH)
  if (!tooltip) tooltip = makeTooltip(matrixContainer.value)

  const g = svg.append('g').attr('transform', `translate(${MARGINS.left},${MARGINS.top})`)

  const xScale = d3.scaleBand().domain(types).range([0, innerW]).padding(0.05)
  const yScale = d3.scaleBand().domain(types).range([0, innerH]).padding(0.05)

  // Domain is max over cells; for normalized matrices that's bounded to 0..1.
  let maxVal = 0
  for (const t of types) for (const u of types) {
    const v = M?.[t]?.[u] || 0
    if (v > maxVal) maxVal = v
  }
  const colorScale = d3.scaleSequential(d3.interpolateBlues).domain([0, maxVal || 1])

  const selTypes = selectedNodeTypes.value
  for (const t of types) {
    for (const u of types) {
      const v = M?.[t]?.[u] || 0
      const raw = M_raw?.[t]?.[u] || 0
      const sel = selTypes.has(t) || selTypes.has(u)
      g.append('rect')
        .attr('x', xScale(u))
        .attr('y', yScale(t))
        .attr('width', xScale.bandwidth())
        .attr('height', yScale.bandwidth())
        .attr('fill', colorScale(v))
        .attr('stroke', sel ? SLATE[900] : '#fff')
        .attr('stroke-width', sel ? 2 : 1)
        .style('cursor', 'pointer')
        .on('mouseover', (ev) => showTip(tooltip, ev, cellTooltip(t, u, raw, v)))
        .on('mousemove', (ev) => showTip(tooltip, ev, null))
        .on('mouseout', () => hideTip(tooltip))
        .on('click', () => selectCell(t, u))

      // Skip in-cell label when the band is too narrow.
      if (xScale.bandwidth() > 30) {
        const lum = d3.lab(colorScale(v)).l
        const label = controls.value.normalize === 'none'
          ? FORMATTERS.siCompact(raw)
          : FORMATTERS.percent0(v)
        g.append('text')
          .attr('x', xScale(u) + xScale.bandwidth() / 2)
          .attr('y', yScale(t) + yScale.bandwidth() / 2)
          .attr('dy', '0.35em')
          .attr('text-anchor', 'middle')
          .attr('font-size', 10)
          .attr('fill', lum < 60 ? '#fff' : SLATE[800])
          .attr('pointer-events', 'none')
          .text(label)
      }
    }
  }

  // Axes — type labels in their per-type color. X labels are rotated -45° so
  // they never overlap when many types are visible (the cap bounds them, but
  // even ~12 names overlap horizontally).
  const isNodesMode = controls.value.mode === 'nodes'
  types.forEach(t => {
    const cx = xScale(t) + xScale.bandwidth() / 2
    g.append('text')
      .attr('transform', `translate(${cx},-6) rotate(-45)`)
      .attr('text-anchor', 'start')
      .attr('font-size', 10)
      .attr('font-weight', 500)
      .attr('fill', typeColor(t))
      .text(t)
  })

  types.forEach(t => {
    g.append('text')
      .attr('x', -8)
      .attr('y', yScale(t) + yScale.bandwidth() / 2)
      .attr('dy', '0.35em')
      .attr('text-anchor', 'end')
      .attr('font-size', 10)
      .attr('font-weight', 500)
      .attr('fill', typeColor(t))
      .text(t)
  })

  // Axis label headings. Source/Target only make sense with a direction; on an
  // undirected graph the edge matrix is symmetric, so we drop the misleading
  // From→To wording and just name the axes by what they are (node type).
  const directed = data.value?.directed ?? false
  let colLabel, rowLabel
  if (isNodesMode) {
    colLabel = 'Neighbor (1-hop)'
    rowLabel = 'From'
  } else if (directed) {
    colLabel = 'Target'
    rowLabel = 'Source'
  } else {
    colLabel = 'Node type'
    rowLabel = 'Node type'
  }
  svg.append('text')
    .attr('x', MARGINS.left + innerW / 2)
    .attr('y', 14)
    .attr('text-anchor', 'middle')
    .attr('font-size', 11)
    .attr('fill', SLATE[600])
    .text(colLabel)

  svg.append('text')
    .attr('transform', `rotate(-90)`)
    .attr('x', -(MARGINS.top + innerH / 2))
    .attr('y', 14)
    .attr('text-anchor', 'middle')
    .attr('font-size', 11)
    .attr('fill', SLATE[600])
    .text(rowLabel)
}

function cellTooltip(src, dst, raw, normalized) {
  const isPct = controls.value.normalize !== 'none'
  const fmtRaw = Number.isInteger(raw) ? raw.toLocaleString() : FORMATTERS.number3(raw)
  const main = isPct
    ? `${FORMATTERS.percent(normalized)} (${fmtRaw} raw)`
    : fmtRaw
  // Arrow only when direction is meaningful (directed edges); otherwise a dash.
  const directed = (data.value?.directed ?? false) && controls.value.mode === 'edges'
  const sep = directed ? '→' : '·'
  return `<b>${src}</b> ${sep} <b>${dst}</b><br>${main}`
}

function selectCell(src, dst) {
  // All ids of the two effective types; replaceCapped applies the cap + tracks overflow.
  selection.replaceCapped(idsOfTypesSoA(nodesSoA.value, [src, dst], nodeTypeAt), SELECTION_CAP)
}

// Aux per-edge-type r bars (widened mode).
function renderAux() {
  if (!auxContainer.value) return
  d3.select(auxContainer.value).selectAll('*').remove()
  if (!props.widened || !data.value) return

  const per = data.value.assortativity?.per_edge_type || {}
  const rows = Object.entries(per)
    .filter(([, v]) => v != null)
    .sort((a, b) => Math.abs(b[1]) - Math.abs(a[1]))
  if (!rows.length) return

  const margins = { top: 24, right: 16, bottom: 24, left: 90 }
  const { totalW, totalH, innerW, innerH } = svgFrame(auxContainer.value, margins, { fallbackW: 300, fallbackH: 300 })

  const svg = d3.select(auxContainer.value).append('svg').attr('width', totalW).attr('height', totalH)
  const g = svg.append('g').attr('transform', `translate(${margins.left},${margins.top})`)

  svg.append('text')
    .attr('x', margins.left + innerW / 2).attr('y', 14)
    .attr('text-anchor', 'middle').attr('font-size', 11).attr('fill', SLATE[600])
    .text('Assortativity r per edge type')

  const xScale = d3.scaleLinear().domain([-1, 1]).range([0, innerW])
  const yScale = d3.scaleBand().domain(rows.map(r => r[0])).range([0, innerH]).padding(0.15)

  g.append('g').call(d3.axisLeft(yScale).tickSize(0))
    .selectAll('text').attr('font-size', 10).attr('fill', SLATE[600])
  g.append('g').attr('transform', `translate(0,${innerH})`)
    .call(d3.axisBottom(xScale).ticks(5).tickFormat(FORMATTERS.fixed1))
    .selectAll('text').attr('font-size', 10).attr('fill', SLATE[600])

  g.append('line')
    .attr('x1', xScale(0)).attr('x2', xScale(0))
    .attr('y1', 0).attr('y2', innerH)
    .attr('stroke', SLATE[300]).attr('stroke-dasharray', '2,2')

  g.selectAll('rect.bar').data(rows).join('rect')
    .attr('class', 'bar')
    .attr('y', d => yScale(d[0]))
    .attr('height', yScale.bandwidth())
    .attr('x', d => xScale(Math.min(0, d[1])))
    .attr('width', d => Math.abs(xScale(d[1]) - xScale(0)))
    .attr('fill', d => d[1] > 0.1 ? COLOR_SCHEME.success : d[1] < -0.1 ? COLOR_SCHEME.danger : SLATE[400])
    .attr('opacity', 0.85)
    .style('cursor', 'pointer')
    .on('click', (_, d) => updateControl('edgeTypeFilter', controls.value.edgeTypeFilter === d[0] ? null : d[0]))

  g.selectAll('text.val').data(rows).join('text')
    .attr('class', 'val')
    .attr('x', d => xScale(d[1]) + (d[1] >= 0 ? 4 : -4))
    .attr('y', d => yScale(d[0]) + yScale.bandwidth() / 2)
    .attr('dy', '0.35em')
    .attr('text-anchor', d => d[1] >= 0 ? 'start' : 'end')
    .attr('font-size', 10).attr('fill', SLATE[600])
    .text(d => FORMATTERS.number(d[1]))
}

function renderAll() { renderMatrix(); renderAux() }

watch([data, controls, () => props.widened, nodeTypes, edgeTypes, activeMatrix, orderedTypes, selectedNodeTypes], () => nextTick(renderAll), { deep: true })

useD3Chart([matrixContainer, auxContainer], renderAll, () => [props.widened, props.expanded])

function toggleAux() {
  if (props.widened) emit('request-shrink')
  else emit('request-widen')
}

const isEmpty = computed(() => !loading.value && data.value && nodeTypes.value.length < 2)
const isFilteredEmpty = computed(() =>
  !loading.value && data.value && allNodeTypes.value.length >= 2 && nodeTypes.value.length < 2
)
</script>

<template>
  <div class="flex flex-col gap-1.5">
    <Teleport v-if="theoryTarget" :to="`#${theoryTarget}`">
      <div class="flex flex-col gap-4 text-sm leading-relaxed text-secondary">

        <section class="flex flex-col gap-2">
          <h3 class="text-xs font-semibold uppercase tracking-widest text-muted">Reading this matrix</h3>
          <p>
            Each cell <strong>(row → column)</strong> measures how the row type connects to the column
            type. Darker = more. A <strong>diagonal-heavy</strong> matrix means types mostly connect
            within themselves (assortative); bright <strong>off-diagonal</strong> cells mean two types
            bridge to each other. {{ data?.directed ? 'On this directed graph rows are the source type, columns the target.' : 'The graph is undirected, so the matrix is symmetric.' }}
          </p>
        </section>

        <section class="flex flex-col gap-2">
          <h3 class="text-xs font-semibold uppercase tracking-widest text-muted">Edges vs Neighbors</h3>
          <p>
            The
            <button :class="theoryLinkClass(controls.mode === 'edges')"
              @click="updateControl('mode', 'edges')">Edges</button>
            mode counts <strong>how many connections</strong> run between two types — every edge counts,
            even repeats. The
            <button :class="theoryLinkClass(controls.mode === 'nodes')"
              @click="updateControl('mode', 'nodes')">Neighbors</button>
            mode counts <strong>how many distinct partners</strong> — the same neighbor reached many
            times counts once.
          </p>
          <p class="text-[13px] text-muted">
            Example: a person who recorded the <em>same</em> song three times →
            <strong>Edges = 3</strong> (three links) but <strong>Neighbors = 1</strong> (one distinct
            song). If the three records were three <em>different</em> songs, both are 3. So the two modes
            differ only when multiple edges hit the same node — Edges shows traffic, Neighbors shows reach.
          </p>
        </section>

        <section class="flex flex-col gap-2">
          <h3 class="text-xs font-semibold uppercase tracking-widest text-muted">Normalizing &amp; the number r</h3>
          <p>
            Raw counts let big types dominate. Normalize by
            <button :class="theoryLinkClass(controls.normalize === 'row')"
              @click="updateControl('normalize', 'row')">row</button>
            ("of everything a row type connects to, what share goes here?"),
            <button :class="theoryLinkClass(controls.normalize === 'col')"
              @click="updateControl('normalize', 'col')">column</button>,
            or keep
            <button :class="theoryLinkClass(controls.normalize === 'none')"
              @click="updateControl('normalize', 'none')">raw</button>
            counts. The <strong>Newman r</strong> below summarizes the matrix in one number:
            r≈1 strongly assortative (like connects to like), r≈−1 disassortative, r≈0 random. It is
            computed on the full graph, except when you pick a single edge type, where it is computed
            for that edge type alone.
          </p>
        </section>

      </div>
    </Teleport>

    <Teleport v-if="controlsTarget" :to="`#${controlsTarget}`">
      <div class="grid grid-cols-2 auto-rows-min gap-1.5">
        <ControlSection title="Mode">
          <ControlToggleGroup
            :model-value="controls.mode"
            :options="MODE_OPTIONS"
            @update:model-value="updateControl('mode', $event)"
          />
        </ControlSection>

        <ControlSection title="Normalize">
          <ControlToggleGroup
            :model-value="controls.normalize"
            :options="NORM_OPTIONS"
            @update:model-value="updateControl('normalize', $event)"
          />
        </ControlSection>

        <ControlSection title="Sort" :col-span="2">
          <ControlToggleGroup
            :model-value="controls.sort"
            :options="SORT_OPTIONS"
            @update:model-value="updateControl('sort', $event)"
          />
          <p class="text-[10px] text-muted mt-1 leading-tight">
            Row/column order. The cap always keeps the most-connected types regardless of this.
          </p>
        </ControlSection>

        <SliderControl
          v-if="nodeTypes.length > 6"
          title="Max types"
          :col-span="2"
          :model-value="controls.maxTypes"
          :min="5" :max="30" :step="1"
          @update:model-value="updateControl('maxTypes', $event)"
        />

        <ControlSection v-if="controls.mode === 'edges' && edgeTypes.length > 1" title="Edge Type" :col-span="2">
          <select
            class="input-base w-full text-xs px-2 py-1"
            :value="controls.edgeTypeFilter ?? ''"
            @change="(e) => updateControl('edgeTypeFilter', e.target.value === '' ? null : e.target.value)"
          >
            <option value="">All</option>
            <option v-for="et in edgeTypes" :key="et" :value="et">{{ et }}</option>
          </select>
        </ControlSection>

        <ControlSection v-if="edgeTypes.length > 1" title="Detail" :col-span="2">
          <button class="text-[11px] text-sky-600 hover:underline" @click="toggleAux">
            {{ widened ? 'Hide per-edge-type r' : 'Show per-edge-type r' }}
          </button>
        </ControlSection>
      </div>
    </Teleport>

    <div v-if="loading" class="text-sm text-secondary p-3 surface-recessed rounded-lg">Loading mixing matrix…</div>
    <div v-if="error" class="text-sm text-red-600 p-3 bg-red-50 rounded-lg border border-red-200">{{ error }}</div>

    <div v-if="!loading && !error">
      <div v-if="isEmpty" class="flex flex-col items-center justify-center gap-2 surface-recessed rounded-lg p-6 text-sm text-secondary" style="aspect-ratio: 4/3;">
        <Grid3x3 :size="36" class="text-muted" />
        <p v-if="isFilteredEmpty" class="text-center">Need at least two visible node types — current filter leaves {{ nodeTypes.length }}.</p>
        <p v-else class="text-center">Need at least two node types to build a mixing matrix.</p>
      </div>

      <div v-else :class="widened ? 'grid grid-cols-2 gap-6' : ''">
        <div class="flex flex-col gap-1 min-w-0">
          <div ref="matrixContainer" class="chart-elev w-full min-w-0" style="aspect-ratio: 4/3; position: relative;"></div>
          <div v-if="data" class="flex items-center justify-center gap-2 text-[11px] text-muted">
            <span class="rounded px-2 py-0.5 font-semibold tabular-nums" :class="rBadgeClass(activeR)"
                  :title="data.assortativity?.caveat || ''">
              Newman r = {{ activeR == null ? 'N/A' : activeR.toFixed(2) }}
            </span>
            <span v-if="controls.edgeTypeFilter && controls.mode === 'edges'" class="text-muted">· edge type: {{ controls.edgeTypeFilter }}</span>
          </div>
          <p v-if="noNodesActive" class="text-[10px] italic text-amber-600 px-1 text-center">No data under current filters.</p>
          <p v-else-if="controls.edgeTypeFilter && controls.mode === 'edges'" class="text-[10px] leading-tight text-muted px-1 text-center">
            Newman r computed for the {{ controls.edgeTypeFilter }} edges only; matrix shows the currently visible type rows/columns.
          </p>
          <p v-else-if="edgeFilterActive" class="text-[10px] italic text-muted px-1 text-center">
            Newman r computed on the full graph; matrix counts reflect the active edge subset.
          </p>
          <p v-else class="text-[10px] leading-tight text-muted px-1 text-center">
            Newman r computed on the full graph; matrix shows the currently visible type rows/columns.
          </p>
          <p v-if="hiddenCount > 0" class="text-[10px] leading-tight text-muted px-1 text-center">
            Showing the {{ controls.maxTypes }} highest-volume types; {{ hiddenCount }} more hidden (raise “Max types” in settings). Newman r still uses the full graph.
          </p>
          <p v-if="selection.overflow > 0" class="text-[10px] italic text-amber-600 px-1 text-center">
            Selection capped at {{ SELECTION_CAP }} — +{{ selection.overflow }} more not selected.
          </p>
        </div>
        <div v-if="widened" ref="auxContainer" class="chart-elev w-full min-w-0 h-full" style="position: relative;"></div>
      </div>
    </div>
  </div>
</template>
