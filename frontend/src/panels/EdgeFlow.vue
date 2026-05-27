<script setup>
import { ref, computed, toRef, watch, nextTick } from 'vue'
import * as d3 from 'd3'
import { Spline } from 'lucide-vue-next'
import { useEdgeFlow } from '@/composables/useEdgeFlow.js'
import { injectGraphNodes } from '@/composables/useGraphNodes.js'
import { injectGraphEdges } from '@/composables/useGraphEdges.js'
import { useNodeTypeColors } from '@/composables/useNodeTypeColors.js'
import { useEffectiveType } from '@/composables/useEffectiveType.js'
import { usePanelContextFromProps } from '@/composables/usePanelContext.js'
import { useSelectionStore, SELECTION_CAPS } from '@/stores/selection.js'
import { usePanel } from './usePanel.js'
import { useD3Chart } from './useD3Chart.js'
import { makeTooltip, showTip, hideTip } from './shared.js'
import ControlSection from './controls/ControlSection.vue'
import ControlSwitch from './controls/ControlSwitch.vue'

const props = defineProps({
  panelSpec: { type: Object, required: true },
  schema: { type: Object, default: null },
  graphId: { type: String, default: null },
  widened: { type: Boolean, default: false },
  controlsTarget: { type: String, default: null },
})

const emit = defineEmits(['request-widen', 'request-shrink'])

const { data, loading, error } = useEdgeFlow(toRef(props, 'graphId'))
const { nodes: nodesSoA } = injectGraphNodes(toRef(props, 'graphId'))
const { edges: edgesSoA } = injectGraphEdges(toRef(props, 'graphId'))
const { color: typeColor } = useNodeTypeColors(toRef(props, 'schema'))
const { nodeTypeAt, nodeTypeList } = useEffectiveType(toRef(props, 'graphId'), toRef(props, 'schema'))
const { activeEdgeMask, edgeFilterActive, noNodesActive } = usePanelContextFromProps(props)
const selection = useSelectionStore()
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

const SELECTION_CAP = SELECTION_CAPS.edge_flow
const MARGINS = { top: 20, right: 20, bottom: 20, left: 20 }

const edgeColorScale = computed(() => {
  const types = data.value?.edge_types ?? []
  // Tableau10 + Set3 = ~22 distinct hues, well above MC1's 12 edge types.
  const palette = d3.schemeTableau10.concat(d3.schemeSet3)
  return d3.scaleOrdinal().domain(types).range(palette)
})

const filteredFlows = computed(() => {
  const { srcTypeFilter, dstTypeFilter, edgeTypeFilter, topN, minFlow } = controls.value
  // Global node/edge type filters already encoded into liveFlows via activeEdgeMask;
  // here we apply only the panel-local refiners.
  let list = liveFlows.value
  if (srcTypeFilter) list = list.filter(f => f.src_type === srcTypeFilter)
  if (dstTypeFilter) list = list.filter(f => f.dst_type === dstTypeFilter)
  if (edgeTypeFilter) list = list.filter(f => f.edge_type === edgeTypeFilter)
  if (minFlow > 0) list = list.filter(f => f.count >= minFlow)
  return list.slice(0, Math.max(1, topN | 0))
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

// Source-type totals for the `normalize` width mode.
const outgoingPerType = computed(() => {
  const m = new Map()
  for (const f of liveFlows.value) {
    m.set(f.src_type, (m.get(f.src_type) || 0) + f.count)
  }
  return m
})

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

const visibleTypes = computed(() => {
  // Only types that participate in at least one visible flow; empty → all types.
  // Type list uses effective labels when auto-promoted (e.g. Karate's club).
  const used = new Set()
  for (const f of filteredFlows.value) { used.add(f.src_type); used.add(f.dst_type) }
  const all = nodeTypeList.value.length ? nodeTypeList.value : (data.value?.node_types ?? [])
  if (!used.size) return all
  return all.filter(t => used.has(t))
})

function isDirected() { return !!data.value?.directed }

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
  if (!tooltip) tooltip = makeTooltip(mainContainer.value)

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
  const radius = Math.max(30, Math.min(innerW, innerH) / 2 - 60)
  const nodeCounts = effectiveNodeCounts.value
  const maxCount = d3.max(types, t => nodeCounts[t] || 0) || 1
  const sizeScale = d3.scaleSqrt().domain([0, maxCount]).range([12, 40])

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

  // Per-edge-type colored arrowhead markers.
  if (isDirected()) {
    const defs = svg.append('defs')
    for (const et of (data.value.edge_types || [])) {
      const safeId = `ef-arrow-${et.replace(/[^A-Za-z0-9]/g, '_')}`
      defs.append('marker')
        .attr('id', safeId)
        .attr('viewBox', '0 -5 10 10')
        .attr('refX', 9).attr('refY', 0)
        .attr('markerWidth', 5).attr('markerHeight', 5)
        .attr('orient', 'auto')
        .append('path').attr('d', 'M0,-4L8,0L0,4').attr('fill', edgeColorScale.value(et))
    }
  }

  const arcsG = svg.append('g').attr('class', 'arcs')

  const widthDomainMax = controls.value.normalize
    ? 1
    : (d3.max(filteredFlows.value, f => f.count) || 1)
  const widthScale = d3.scaleSqrt().domain([0, widthDomainMax]).range([0.5, 8])

  for (const [key, arcs] of arcBundles.value.entries()) {
    const [src, dst] = key.split('|')
    const a = nodePos.get(src)
    const b = nodePos.get(dst)
    if (!a || !b) continue
    arcs.forEach((f, idx) => {
      const ratio = controls.value.normalize
        ? (f.count / (outgoingPerType.value.get(f.src_type) || 1))
        : f.count
      const stroke = edgeColorScale.value(f.edge_type)
      const markerId = `ef-arrow-${f.edge_type.replace(/[^A-Za-z0-9]/g, '_')}`

      let path
      if (src === dst) {
        // Self-loop bulges outward along the node's radial direction.
        const angleFromCenter = Math.atan2(a.y - cy, a.x - cx)
        const loopR = 18 + idx * 6
        const ox = Math.cos(angleFromCenter)
        const oy = Math.sin(angleFromCenter)
        const start = { x: a.x + a.r * Math.cos(angleFromCenter - 0.25), y: a.y + a.r * Math.sin(angleFromCenter - 0.25) }
        const end = { x: a.x + a.r * Math.cos(angleFromCenter + 0.25), y: a.y + a.r * Math.sin(angleFromCenter + 0.25) }
        const ctrl = { x: a.x + (a.r + loopR) * ox, y: a.y + (a.r + loopR) * oy }
        path = `M${start.x},${start.y} Q${ctrl.x},${ctrl.y} ${end.x},${end.y}`
      } else {
        // Quadratic curve; bundle siblings offset perpendicular to the chord.
        const offsetSign = (idx - (arcs.length - 1) / 2)
        const offset = offsetSign * 14
        const mx = (a.x + b.x) / 2
        const my = (a.y + b.y) / 2
        const dx = b.x - a.x, dy = b.y - a.y
        const len = Math.sqrt(dx * dx + dy * dy) || 1
        const nx = -dy / len, ny = dx / len
        const ctrlX = mx + nx * offset
        const ctrlY = my + ny * offset
        path = `M${a.x},${a.y} Q${ctrlX},${ctrlY} ${b.x},${b.y}`
      }

      const arc = arcsG.append('path')
        .attr('d', path)
        .attr('fill', 'none')
        .attr('stroke', stroke)
        .attr('stroke-width', widthScale(ratio))
        .attr('stroke-opacity', 0.7)
        .style('cursor', 'pointer')
        .on('mouseover', (ev) => showTip(tooltip, ev, tooltipFlow(f)))
        .on('mousemove', (ev) => showTip(tooltip, ev, null))
        .on('mouseout', () => hideTip(tooltip))
        .on('click', () => selectFlow(f))
      if (isDirected()) arc.attr('marker-end', `url(#${markerId})`)
    })
  }

  // Meta-nodes.
  const nodesG = svg.append('g').attr('class', 'meta-nodes')
  for (const t of types) {
    const p = nodePos.get(t)
    const g = nodesG.append('g')
      .attr('transform', `translate(${p.x},${p.y})`)
      .style('cursor', 'pointer')
      .on('mouseover', (ev) => showTip(tooltip, ev, tooltipType(t)))
      .on('mousemove', (ev) => showTip(tooltip, ev, null))
      .on('mouseout', () => hideTip(tooltip))
      .on('click', () => selectType(t))
    g.append('circle')
      .attr('r', p.r)
      .attr('fill', typeColor(t))
      .attr('stroke', '#fff')
      .attr('stroke-width', 1.5)
      .attr('opacity', 0.9)
    g.append('text')
      .attr('text-anchor', 'middle')
      .attr('dy', '0.35em')
      .attr('font-size', 11)
      .attr('font-weight', 600)
      .attr('fill', '#fff')
      .attr('pointer-events', 'none')
      .text(t)
  }

  // Edge-type legend (top-right).
  const legend = svg.append('g').attr('class', 'edge-legend')
    .attr('transform', `translate(${totalW - 8}, 14)`)
  const visibleEdgeTypes = Array.from(new Set(filteredFlows.value.map(f => f.edge_type)))
  visibleEdgeTypes.forEach((et, i) => {
    const y = i * 13
    const row = legend.append('g')
      .attr('transform', `translate(0, ${y})`)
      .style('cursor', 'pointer')
      .on('click', () => {
        updateControl('edgeTypeFilter', controls.value.edgeTypeFilter === et ? null : et)
      })
    row.append('rect')
      .attr('x', -10).attr('y', -5).attr('width', 8).attr('height', 8)
      .attr('rx', 1).attr('fill', edgeColorScale.value(et))
      .attr('opacity', controls.value.edgeTypeFilter === et || !controls.value.edgeTypeFilter ? 1 : 0.3)
    row.append('text')
      .attr('text-anchor', 'end').attr('x', -14).attr('y', 4)
      .attr('font-size', 10).attr('fill', '#475569').text(et)
  })

  // Normalize indicator.
  if (controls.value.normalize) {
    svg.append('text').attr('x', 8).attr('y', 12)
      .attr('font-size', 10).attr('fill', '#0ea5e9')
      .text('Width: normalized (count / total outgoing)')
  }
}

function tooltipFlow(f) {
  const pct = totalFlowSum.value ? ((f.count / totalFlowSum.value) * 100).toFixed(1) : '?'
  const arrow = isDirected() ? '→' : '—'
  return `<b>${f.src_type}</b> ${arrow}<i>${f.edge_type}</i>${arrow} <b>${f.dst_type}</b><br>${f.count.toLocaleString()} edges (${pct}% of shown)`
}
function tooltipType(t) {
  const count = effectiveNodeCounts.value[t] ?? 0
  return `<b>${t}</b><br>${count.toLocaleString()} nodes`
}

function _idsOfEffectiveTypes(wanted, cap) {
  const soa = nodesSoA.value
  if (!soa) return []
  const want = wanted instanceof Set ? wanted : new Set(Array.isArray(wanted) ? wanted : [wanted])
  const out = []
  for (let i = 0; i < soa.N; i++) {
    if (want.has(nodeTypeAt(i))) {
      out.push(soa.ids[i])
      if (out.length >= cap) break
    }
  }
  return out
}

function selectFlow(f) {
  selection.replace(_idsOfEffectiveTypes([f.src_type, f.dst_type], SELECTION_CAP))
}
function selectType(t) {
  selection.replace(_idsOfEffectiveTypes(t, SELECTION_CAP))
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
    .on('click', (_, f) => {
      updateControl('srcTypeFilter', f.src_type)
      updateControl('dstTypeFilter', f.dst_type)
      updateControl('edgeTypeFilter', f.edge_type)
    })

  rows.append('td').attr('class', 'px-2 py-1 border-b border-slate-100').text(f => f.src_type)
  rows.append('td').attr('class', 'px-2 py-1 border-b border-slate-100')
    .append('span')
    .style('color', f => edgeColorScale.value(f.edge_type))
    .text(f => f.edge_type)
  rows.append('td').attr('class', 'px-2 py-1 border-b border-slate-100').text(f => f.dst_type)
  rows.append('td').attr('class', 'px-2 py-1 border-b border-slate-100 text-right tabular-nums').text(f => f.count.toLocaleString())
  rows.append('td').attr('class', 'px-2 py-1 border-b border-slate-100 text-right tabular-nums text-muted')
    .text(f => `${((f.count / total) * 100).toFixed(1)}%`)
}

function renderAll() { renderMain(); renderTable() }

watch([data, controls, () => props.widened, liveFlows], () => nextTick(renderAll), { deep: true })

useD3Chart([mainContainer, tableContainer], renderAll)

function toggleWiden() {
  if (props.widened) emit('request-shrink')
  else emit('request-widen')
}
</script>

<template>
  <div class="flex flex-col gap-1.5">
    <Teleport v-if="controlsTarget" :to="`#${controlsTarget}`">
      <div class="grid grid-cols-2 auto-rows-min gap-1.5">
        <ControlSection title="Source Type">
          <select
            class="input-base w-full text-xs px-2 py-1"
            :value="controls.srcTypeFilter ?? ''"
            @change="(e) => updateControl('srcTypeFilter', e.target.value === '' ? null : e.target.value)"
          >
            <option value="">All</option>
            <option v-for="t in (nodeTypeList.length ? nodeTypeList : (data?.node_types || []))" :key="t" :value="t">{{ t }}</option>
          </select>
        </ControlSection>

        <ControlSection title="Target Type">
          <select
            class="input-base w-full text-xs px-2 py-1"
            :value="controls.dstTypeFilter ?? ''"
            @change="(e) => updateControl('dstTypeFilter', e.target.value === '' ? null : e.target.value)"
          >
            <option value="">All</option>
            <option v-for="t in (nodeTypeList.length ? nodeTypeList : (data?.node_types || []))" :key="t" :value="t">{{ t }}</option>
          </select>
        </ControlSection>

        <ControlSection title="Edge Type" :col-span="2">
          <select
            class="input-base w-full text-xs px-2 py-1"
            :value="controls.edgeTypeFilter ?? ''"
            @change="(e) => updateControl('edgeTypeFilter', e.target.value === '' ? null : e.target.value)"
          >
            <option value="">All</option>
            <option v-for="et in (data?.edge_types || [])" :key="et" :value="et">{{ et }}</option>
          </select>
        </ControlSection>

        <ControlSection title="Top-N flows">
          <input
            type="number" min="1" max="500"
            class="input-base w-full text-xs px-2 py-1 tabular-nums"
            :value="controls.topN"
            @change="(e) => updateControl('topN', Math.max(1, Number(e.target.value) || 50))"
          />
        </ControlSection>

        <ControlSection title="Min flow">
          <input
            type="number" min="0"
            class="input-base w-full text-xs px-2 py-1 tabular-nums"
            :value="controls.minFlow"
            @change="(e) => updateControl('minFlow', Math.max(0, Number(e.target.value) || 0))"
          />
        </ControlSection>

        <ControlSection title="Width" :col-span="2">
          <ControlSwitch
            label="Normalize (count / total outgoing)"
            :model-value="controls.normalize"
            @update:model-value="updateControl('normalize', $event)"
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
    <p v-if="!loading && !error" class="text-[10px] leading-tight text-muted px-1">
      <template v-if="edgeFilterActive">Flows recomputed on the active edge subset.</template>
      <template v-else>Flow counts on the full graph; deselect types via chips to refine.</template>
    </p>
  </div>
</template>
