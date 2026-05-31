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
import { makeTooltip, showTip, hideTip, svgFrame, FORMATTERS, selectedTypesIn, idsOfTypesSoA } from './shared.js'
import ControlSection from './controls/ControlSection.vue'
import ControlToggleGroup from './controls/ControlToggleGroup.vue'

const props = defineProps({
  panelSpec: { type: Object, required: true },
  schema: { type: Object, default: null },
  graphId: { type: String, default: null },
  widened: { type: Boolean, default: false },
  expanded: { type: Boolean, default: false },
  controlsTarget: { type: String, default: null },
})

const emit = defineEmits(['request-widen', 'request-shrink'])

const { data, loading, error } = useTypeMixing(toRef(props, 'graphId'))
const { nodes: nodesSoA } = injectGraphNodes(toRef(props, 'graphId'))
const { edges: edgesSoA } = injectGraphEdges(toRef(props, 'graphId'))
const { color: typeColor } = useNodeTypeColors(toRef(props, 'schema'))
const { nodeTypeAt, edgeTypeAt, nodeTypeList } = useEffectiveType(toRef(props, 'graphId'), toRef(props, 'schema'))
const { activeNodeMask, activeEdgeMask, selectedMask, edgeFilterActive, noNodesActive } = usePanelContextFromProps(props)
const selection = useSelectionStore()
const { controls, updateControl } = usePanel(props, 'type_mixing', data)

// Effective node types with ≥1 node in the current selection. A cell (t,u) is
// outlined when t or u is in this set (cap-safe). Shared helper, same logic in EdgeFlow.
const selectedNodeTypes = computed(() =>
  selectedTypesIn(nodesSoA.value?.N ?? 0, selectedMask.value, nodeTypeAt))

const matrixContainer = ref(null)
const auxContainer = ref(null)
let tooltip = null

const SELECTION_CAP = SELECTION_CAPS.type_mixing
const MARGINS = { top: 50, right: 12, bottom: 14, left: 70 }

const MODE_OPTIONS = [
  { k: 'edges', label: 'Edges' },
  { k: 'nodes', label: 'Neighbors' },
]
const NORM_OPTIONS = [
  { k: 'none', label: 'None' },
  { k: 'row', label: 'Row' },
  { k: 'col', label: 'Col' },
]

// Rows/cols collapse to the visible set; Newman r stays anchored to the full graph.
// `nodeTypeList` returns the effective labels (auto-promoted) or raw types.
const allNodeTypes = computed(() => nodeTypeList.value.length ? nodeTypeList.value : (data.value?.node_types || []))
const allEdgeTypes = computed(() => data.value?.edge_types || [])
// Contract: visible rows/cols are derived from the global masks, not from the raw
// filters.nodeTypes/edgeTypes chip arrays. A type is visible iff it has ≥1 element
// surviving the mask — so degree/attr/wcc filters that empty a type drop its row,
// not just the type chip group. Effective-type aware via nodeTypeAt/edgeTypeAt.
const nodeTypes = computed(() => {
  const soa = nodesSoA.value
  const m = activeNodeMask.value
  if (!soa || !m) return allNodeTypes.value
  const present = new Set()
  for (let i = 0; i < soa.N; i++) if (m.get(i)) present.add(nodeTypeAt(i))
  return allNodeTypes.value.filter(t => present.has(t))
})
const edgeTypes = computed(() => {
  const soa = edgesSoA.value
  const m = activeEdgeMask.value
  if (!soa || !m) return allEdgeTypes.value
  const present = new Set()
  for (let i = 0; i < soa.E; i++) if (m.get(i)) present.add(edgeTypeAt(i))
  return allEdgeTypes.value.filter(t => present.has(t))
})

// Matrix is always recomputed client-side from edges SoA + activeEdgeMask:
// no double codepath, edge mask (type/weight/selfLoop) propagates uniformly.
const activeMatrix = computed(() => {
  const soaN = nodesSoA.value
  const soaE = edgesSoA.value
  const eMask = activeEdgeMask.value
  if (!soaN || !soaE || !eMask) return null

  const types = allNodeTypes.value
  if (!types.length) return null

  const out = {}
  for (const t of types) {
    out[t] = {}
    for (const u of types) out[t][u] = 0
  }

  const localEdgeTypeFilter = (controls.value.mode === 'edges' && controls.value.edgeTypeFilter)
    ? controls.value.edgeTypeFilter
    : null
  const directed = data.value?.directed ?? false

  if (controls.value.mode === 'edges') {
    for (let i = 0; i < soaE.E; i++) {
      if (!eMask.get(i)) continue
      if (localEdgeTypeFilter && soaE.edgeTypes[soaE.type[i]] !== localEdgeTypeFilter) continue
      const st = nodeTypeAt(soaE.source[i])
      const dt = nodeTypeAt(soaE.target[i])
      if (st in out && dt in out[st]) out[st][dt] += 1
    }
    return out
  }

  // 'nodes' mode: count distinct 1-hop neighbors per (src_type, dst_type).
  // Undirected → symmetric (each edge contributes to both src→dst and dst→src).
  // Nested Map avoids string-key fragility on type names with special chars.
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

function normalizeMatrix(M, types, mode) {
  if (!M || mode === 'none') return M
  const out = {}
  if (mode === 'row') {
    for (const t of types) {
      const total = d3.sum(types, u => M[t]?.[u] || 0)
      out[t] = {}
      for (const u of types) {
        out[t][u] = total ? (M[t]?.[u] || 0) / total : 0
      }
    }
  } else {
    for (const t of types) out[t] = {}
    for (const u of types) {
      const total = d3.sum(types, t => M[t]?.[u] || 0)
      for (const t of types) {
        out[t][u] = total ? (M[t]?.[u] || 0) / total : 0
      }
    }
  }
  return out
}

const displayMatrix = computed(() => normalizeMatrix(activeMatrix.value, nodeTypes.value, controls.value.normalize))

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

  const types = nodeTypes.value
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
        .attr('stroke', sel ? '#0f172a' : '#fff')
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
          .attr('fill', lum < 60 ? '#fff' : '#1e293b')
          .attr('pointer-events', 'none')
          .text(label)
      }
    }
  }

  // Axes — type labels in their per-type color.
  const isNodesMode = controls.value.mode === 'nodes'
  const xAxis = d3.axisTop(xScale).tickSize(0)
  g.append('g').call(xAxis).select('.domain').remove()
  g.selectAll('.tick text').remove()
  types.forEach(t => {
    g.append('text')
      .attr('x', xScale(t) + xScale.bandwidth() / 2)
      .attr('y', -8)
      .attr('text-anchor', 'middle')
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

  // Axis label headings.
  svg.append('text')
    .attr('x', MARGINS.left + innerW / 2)
    .attr('y', 14)
    .attr('text-anchor', 'middle')
    .attr('font-size', 11)
    .attr('fill', '#475569')
    .text(isNodesMode ? 'Neighbor (1-hop) →' : 'Target →')

  svg.append('text')
    .attr('transform', `rotate(-90)`)
    .attr('x', -(MARGINS.top + innerH / 2))
    .attr('y', 14)
    .attr('text-anchor', 'middle')
    .attr('font-size', 11)
    .attr('fill', '#475569')
    .text(isNodesMode ? 'From →' : 'Source →')
}

function cellTooltip(src, dst, raw, normalized) {
  const isPct = controls.value.normalize !== 'none'
  const fmtRaw = Number.isInteger(raw) ? raw.toLocaleString() : FORMATTERS.number3(raw)
  const main = isPct
    ? `${FORMATTERS.percent(normalized)} (${fmtRaw} raw)`
    : fmtRaw
  return `<b>${src}</b> → <b>${dst}</b><br>${main}`
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
    .attr('text-anchor', 'middle').attr('font-size', 11).attr('fill', '#475569')
    .text('Assortativity r per edge type')

  const xScale = d3.scaleLinear().domain([-1, 1]).range([0, innerW])
  const yScale = d3.scaleBand().domain(rows.map(r => r[0])).range([0, innerH]).padding(0.15)

  g.append('g').call(d3.axisLeft(yScale).tickSize(0))
    .selectAll('text').attr('font-size', 10).attr('fill', '#475569')
  g.append('g').attr('transform', `translate(0,${innerH})`)
    .call(d3.axisBottom(xScale).ticks(5).tickFormat(FORMATTERS.fixed1))
    .selectAll('text').attr('font-size', 10).attr('fill', '#475569')

  g.append('line')
    .attr('x1', xScale(0)).attr('x2', xScale(0))
    .attr('y1', 0).attr('y2', innerH)
    .attr('stroke', '#cbd5e1').attr('stroke-dasharray', '2,2')

  g.selectAll('rect.bar').data(rows).join('rect')
    .attr('class', 'bar')
    .attr('y', d => yScale(d[0]))
    .attr('height', yScale.bandwidth())
    .attr('x', d => xScale(Math.min(0, d[1])))
    .attr('width', d => Math.abs(xScale(d[1]) - xScale(0)))
    .attr('fill', d => d[1] > 0.1 ? '#10b981' : d[1] < -0.1 ? '#ef4444' : '#94a3b8')
    .attr('opacity', 0.85)
    .style('cursor', 'pointer')
    .on('click', (_, d) => updateControl('edgeTypeFilter', controls.value.edgeTypeFilter === d[0] ? null : d[0]))

  g.selectAll('text.val').data(rows).join('text')
    .attr('class', 'val')
    .attr('x', d => xScale(d[1]) + (d[1] >= 0 ? 4 : -4))
    .attr('y', d => yScale(d[0]) + yScale.bandwidth() / 2)
    .attr('dy', '0.35em')
    .attr('text-anchor', d => d[1] >= 0 ? 'start' : 'end')
    .attr('font-size', 10).attr('fill', '#475569')
    .text(d => FORMATTERS.number(d[1]))
}

function renderAll() { renderMatrix(); renderAux() }

watch([data, controls, () => props.widened, nodeTypes, edgeTypes, activeMatrix, selectedNodeTypes], () => nextTick(renderAll), { deep: true })

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

        <ControlSection v-if="controls.mode === 'edges'" title="Edge Type" :col-span="2">
          <select
            class="input-base w-full text-xs px-2 py-1"
            :value="controls.edgeTypeFilter ?? ''"
            @change="(e) => updateControl('edgeTypeFilter', e.target.value === '' ? null : e.target.value)"
          >
            <option value="">All</option>
            <option v-for="et in edgeTypes" :key="et" :value="et">{{ et }}</option>
          </select>
        </ControlSection>

        <ControlSection title="Detail" :col-span="2">
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
          <p v-else-if="edgeFilterActive" class="text-[10px] italic text-muted px-1 text-center">
            Newman r computed on the full graph; matrix counts reflect the active edge subset.
          </p>
          <p v-else class="text-[10px] leading-tight text-muted px-1 text-center">
            Newman r computed on the full graph; matrix shows the currently visible type rows/columns.
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
