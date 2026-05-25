<script setup>
import { ref, watch, toRef, computed, nextTick } from 'vue'
import * as d3 from 'd3'
import Slider from '@vueform/slider'
import '@vueform/slider/themes/default.css'
import { useComponents } from '@/composables/useComponents.js'
import { useGraphNodes } from '@/composables/useGraphNodes.js'
import { useNodeTypeColors } from '@/composables/useNodeTypeColors.js'
import { usePanelContextFromProps } from '@/composables/usePanelContext.js'
import { useSelectionStore, SELECTION_CAPS } from '@/stores/selection.js'
import { Bitset } from '@/utils/bitset.js'
import { makeTooltip, showTip, hideTip } from './shared.js'
import { usePanel } from './usePanel.js'
import { useD3Chart } from './useD3Chart.js'
import ControlSwitch from './controls/ControlSwitch.vue'
import ControlBoolean from './controls/ControlBoolean.vue'
import ControlSection from './controls/ControlSection.vue'
import ControlToggleGroup from './controls/ControlToggleGroup.vue'

const props = defineProps({
  panelSpec: { type: Object, required: true },
  schema: { type: Object, default: null },
  graphId: { type: String, default: null },
  widened: { type: Boolean, default: false },
  controlsTarget: { type: String, default: null },
})

const emit = defineEmits(['request-widen', 'request-shrink'])

const { data, loading, error } = useComponents(toRef(props, 'graphId'))
const { nodes: soa } = useGraphNodes(toRef(props, 'graphId'))
const { color: typeColor } = useNodeTypeColors(toRef(props, 'schema'))
const { activeNodeMask, selectedMask } = usePanelContextFromProps(props)
const selection = useSelectionStore()
const { controls, updateControl } = usePanel(props, 'connectivity', data)
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

function activeByTypeOf(comp) {
  const masks = componentMasks.value
  const act = activeNodeMask.value
  const s = soa.value
  if (!masks || !s) return comp.by_type
  const cm = masks.get(comp.id)
  if (!cm) return {}
  const tmp = cm.clone()
  if (act) tmp.andInPlace(act)
  const out = {}
  for (const idx of tmp) {
    const t = s.types[idx]
    out[t] = (out[t] || 0) + 1
  }
  return out
}

const sizeBounds = computed(() => {
  const s = activeSummary.value
  if (!s || !s.components.length) return { min: 1, max: 1 }
  // Slider domain anchored to full-graph sizes so it stays stable under filtering.
  return {
    min: d3.min(s.components, c => c.size) || 1,
    max: d3.max(s.components, c => c.size) || 1,
  }
})

// Toggle disabled when no singletons exist.
const hasSingletons = computed(() => (activeSummary.value?.singletons ?? 0) > 0)

// Size/rank filter is meaningless with a single component.
const componentCount = computed(() => activeSummary.value?.count ?? 0)
const filterAvailable = computed(() => componentCount.value > 1)

const displayedComponents = computed(() => {
  const s = activeSummary.value
  if (!s) return []
  // Backend returns components sorted by size desc, so index = rank.
  const comps = controls.value.hideSingletons
    ? s.components.filter(c => c.size > 1)
    : s.components

  if (controls.value.filterMode === 'rank') {
    const top = controls.value.rankTop
    const bottom = controls.value.rankBottom
    return comps.filter((_, i) => {
      const fromTop = i + 1
      const fromBottom = comps.length - i
      if (top != null && fromTop > top) return false
      if (bottom != null && fromBottom > bottom) return false
      return true
    })
  }

  const minF = controls.value.sizeMin
  const maxF = controls.value.sizeMax
  return comps.filter(c => {
    if (minF != null && c.size < minF) return false
    if (maxF != null && c.size > maxF) return false
    return true
  })
})

const sliderModel = computed({
  get: () => [
    controls.value.sizeMin ?? sizeBounds.value.min,
    controls.value.sizeMax ?? sizeBounds.value.max,
  ],
  set: ([lo, hi]) => {
    updateControl('sizeMin', lo === sizeBounds.value.min ? null : lo)
    updateControl('sizeMax', hi === sizeBounds.value.max ? null : hi)
  },
})

function clearFilter() {
  updateControl('sizeMin', null)
  updateControl('sizeMax', null)
  updateControl('rankTop', null)
  updateControl('rankBottom', null)
}

const filterActive = computed(() =>
  controls.value.sizeMin != null
  || controls.value.sizeMax != null
  || controls.value.rankTop != null
  || controls.value.rankBottom != null
)

const selectedComponent = computed(() => {
  if (selectedId.value == null) return null
  return displayedComponents.value.find(c => c.id === selectedId.value) ?? null
})

const MARGINS = { top: 8, right: 12, bottom: 28, left: 44 }

const VIEW_OPTIONS = [{ k: 'bubbles', label: 'Bubbles' }, { k: 'bars', label: 'Bars' }]
const LABEL_OPTIONS = [{ k: 'absolute', label: 'N' }, { k: 'percentage', label: '%' }]
const FILTER_OPTIONS = [{ k: 'range', label: 'Range' }, { k: 'rank', label: 'Rank' }]
// SCC option reflects graph directedness.
const modeOptions = computed(() => [
  { k: 'wcc', label: 'WCC' },
  { k: 'scc', label: 'SCC', disabled: !sccAvailable.value, title: sccAvailable.value ? '' : 'SCC requires a directed graph' },
])

watch(() => activeMode.value, () => { selectedId.value = null })
watch(displayedComponents, (list) => {
  if (selectedId.value != null && !list.find(c => c.id === selectedId.value)) {
    selectedId.value = null
  }
})

watch(selectedId, (val) => {
  if (val == null && props.widened) emit('request-shrink')
  if (val != null && !props.widened) emit('request-widen')
})

function renderAll() { renderMain(); renderDrill() }

watch([data, controls, () => props.widened, activeNodeMask, selectedMask, componentMasks], () => nextTick(renderAll), { deep: true })
watch(selectedComponent, () => nextTick(renderDrill))

useD3Chart([mainContainer, drillContainer], renderAll)

// Cap keeps selection bounded on giant LCCs (visible-in-panel, not full component).
const SELECTION_CAP = SELECTION_CAPS.connectivity
function clickComponent(comp) {
  if (selectedId.value === comp.id) {
    selectedId.value = null
    selection.clear()
    return
  }
  selectedId.value = comp.id
  const ids = activeIdsOf(comp).slice(0, SELECTION_CAP)
  selection.replace(ids)
}

// Active size keeps labels coherent with bubble area; comp.size stays in the tooltip.
function formatLabel(comp, total) {
  const n = comp._active ?? activeSizeOf(comp)
  if (controls.value.labelMode === 'percentage') {
    const pct = total ? (n / total) * 100 : 0
    return pct < 0.1 ? '<0.1%' : `${pct.toFixed(1)}%`
  }
  return String(n)
}

function tooltipHtml(comp, total) {
  const n = comp._active ?? activeSizeOf(comp)
  const pct = total ? ((n / total) * 100).toFixed(2) : '?'
  const selN = selectedCountOf(comp)
  const head = `<strong>${activeMode.value.toUpperCase()} #${comp.id + 1}</strong>`
  const body = (n !== comp.size)
    ? `${n.toLocaleString()} / ${comp.size.toLocaleString()} nodes (${pct}%)`
    : `${comp.size.toLocaleString()} nodes (${pct}%)`
  const sel = selN > 0 ? `<br><span style="color:#f59e0b">${selN} selected</span>` : ''
  return `${head}<br>${body}${sel}`
}

function renderMain() {
  if (!mainContainer.value) return
  d3.select(mainContainer.value).selectAll('*').remove()

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
  const colorScale = d3.scaleSequential(d3.interpolateLab('#e0f2fe', '#0369a1')).domain([0, Math.log10(maxSize + 1)])

  // Below this radius the label is omitted; tooltip still surfaces the info.
  const labelRadiusThreshold = controls.value.labelMode === 'percentage' ? 18 : 14

  const node = g.selectAll('g').data(leaves).join('g')
    .attr('transform', d => `translate(${d.x},${d.y})`)
    .style('cursor', 'pointer')
    .on('click', (_, d) => clickComponent(d.data))
    .on('mouseover', (ev, d) => showTip(tooltip, ev, tooltipHtml(d.data, totalNodes)))
    .on('mousemove', (ev) => showTip(tooltip, ev, null))
    .on('mouseout', () => hideTip(tooltip))

  node.append('circle')
    .attr('r', d => d.r)
    .attr('fill', d => colorScale(Math.log10(d.data._active + 1)))
    .attr('stroke', d => selectedCountOf(d.data) > 0 ? '#f59e0b' : '#fff')
    .attr('stroke-width', d => selectedCountOf(d.data) > 0 ? 2 : 1)
    .attr('opacity', d => selectedId.value == null || selectedId.value === d.data.id ? 1 : 0.3)

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
    .attr('fill', d => d.data._active > maxSize / 4 ? 'rgba(255,255,255,0.8)' : '#64748b')
    .text(d => `#${comps.findIndex(c => c.id === d.data.id) + 1}`)

  labelGroup.append('text')
    .attr('text-anchor', 'middle')
    .attr('dy', d => d.r >= rankRadiusThreshold ? '0.85em' : '0.35em')
    .attr('font-size', d => Math.min(d.r * 0.5, 16))
    .attr('font-weight', '600')
    .attr('fill', d => d.data._active > maxSize / 4 ? '#fff' : '#1e293b')
    .text(d => formatLabel(d.data, totalNodes))
}

function renderBars(container, totalW, totalH, comps) {
  const totalNodes = props.schema?.nodes ?? d3.sum(comps, c => c.size)
  const innerW = totalW - MARGINS.left - MARGINS.right
  const innerH = totalH - MARGINS.top - MARGINS.bottom

  const svg = d3.select(container).append('svg').attr('width', totalW).attr('height', totalH)
  const g = svg.append('g').attr('transform', `translate(${MARGINS.left},${MARGINS.top})`)
  const tooltip = makeTooltip(container)

  // Render every displayed component (even 0-active) to make the filter effect explicit.
  comps = comps.map(c => ({ ...c, _active: activeSizeOf(c) }))

  const useLog = !!controls.value.logX
  const minSize = d3.min(comps, c => Math.max(1, c._active)) || 1
  const maxSize = d3.max(comps, c => c._active) || 1

  const xScale = useLog
    ? d3.scaleLog().domain([Math.max(1, minSize), maxSize]).range([0, innerW]).clamp(true)
    : d3.scaleLinear().domain([0, maxSize]).range([0, innerW])

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
    .selectAll('text').attr('font-size', 10).attr('fill', '#64748b')

  const xAxis = d3.axisBottom(xScale).ticks(5, useLog ? '~s' : 'd')
  g.append('g').attr('transform', `translate(0,${innerH})`).call(xAxis)
    .selectAll('text').attr('font-size', 10).attr('fill', '#64748b')

  svg.append('text')
    .attr('x', MARGINS.left + innerW / 2).attr('y', totalH - 4)
    .attr('text-anchor', 'middle').attr('font-size', 11).attr('fill', '#475569')
    .text('Component size')

  // Sky palette mid-tone matches COLOR_SCHEME.accent (sky-600) used by other panels.
  const colorScale = d3.scaleSequential(d3.interpolateLab('#e0f2fe', '#0369a1')).domain([0, Math.log10(maxSize + 1)])

  // Skip text label when the band is shorter than this; tooltip still works.
  const minBandForLabel = 12

  g.selectAll('rect.bar').data(comps).join('rect')
    .attr('class', 'bar')
    .attr('x', 0)
    .attr('y', (_, i) => yScale(i))
    .attr('width', d => useLog ? xScale(Math.max(1, d._active)) : xScale(d._active))
    .attr('height', yScale.bandwidth())
    .attr('fill', d => colorScale(Math.log10(d._active + 1)))
    .attr('stroke', d => selectedCountOf(d) > 0 ? '#f59e0b' : 'none')
    .attr('stroke-width', d => selectedCountOf(d) > 0 ? 2 : 0)
    .attr('opacity', d => selectedId.value == null || selectedId.value === d.id ? 1 : 0.3)
    .style('cursor', 'pointer')
    .on('click', (_, d) => clickComponent(d))
    .on('mouseover', (ev, d) => showTip(tooltip, ev, tooltipHtml(d, totalNodes)))
    .on('mousemove', (ev) => showTip(tooltip, ev, null))
    .on('mouseout', () => hideTip(tooltip))

  if (yScale.bandwidth() >= minBandForLabel) {
    g.selectAll('text.size').data(comps).join('text')
      .attr('class', 'size')
      .attr('x', d => (useLog ? xScale(Math.max(1, d._active)) : xScale(d._active)) + 4)
      .attr('y', (_, i) => yScale(i) + yScale.bandwidth() / 2)
      .attr('dy', '0.35em')
      .attr('font-size', 10).attr('fill', '#475569').attr('pointer-events', 'none')
      .text(d => formatLabel(d, totalNodes))
  }
}

function renderDrill() {
  if (!drillContainer.value || !selectedComponent.value) return
  d3.select(drillContainer.value).selectAll('*').remove()

  const comp = selectedComponent.value
  // Active-subset by_type keeps the drill-down coherent with bubble/bar size.
  const byType = activeByTypeOf(comp)
  const entries = Object.entries(byType).sort((a, b) => b[1] - a[1])
  if (!entries.length) return

  const totalW = drillContainer.value.clientWidth || 400
  const totalH = drillContainer.value.clientHeight || 300

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

  const svg = d3.select(drillContainer.value).append('svg').attr('width', totalW).attr('height', totalH)
  const g = svg.append('g').attr('transform', `translate(${margins.left},${margins.top})`)

  const maxCount = d3.max(entries, d => d[1]) || 1
  const xScale = d3.scaleLinear().domain([0, maxCount]).range([0, innerW])
  const yScale = d3.scaleBand().domain(entries.map(d => d[0])).range([0, innerH]).padding(0.2)

  g.append('g').call(d3.axisLeft(yScale))
    .selectAll('text').attr('font-size', 10).attr('fill', '#64748b')
  g.append('g').attr('transform', `translate(0,${innerH})`)
    .call(d3.axisBottom(xScale).ticks(4, '~s'))
    .selectAll('text').attr('font-size', 10).attr('fill', '#64748b')

  svg.append('text')
    .attr('x', margins.left + innerW / 2).attr('y', totalH - 4)
    .attr('text-anchor', 'middle').attr('font-size', 11).attr('fill', '#475569')
    .text('Node count')

  g.selectAll('rect').data(entries).join('rect')
    .attr('x', 0).attr('y', d => yScale(d[0]))
    .attr('width', d => xScale(d[1]))
    .attr('height', yScale.bandwidth())
    .attr('fill', d => typeColor(d[0])).attr('opacity', 0.85)

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
    .attr('fill', d => isInside(d) ? '#fff' : '#475569')
    .attr('pointer-events', 'none')
    .text(d => d[1].toLocaleString())
}

</script>

<template>
  <div class="flex flex-col gap-1.5">
    <Teleport v-if="controlsTarget" :to="`#${controlsTarget}`">
      <div class="grid grid-cols-2 auto-rows-min gap-1.5">
        <ControlSection title="View">
          <div class="flex flex-col gap-1">
            <ControlToggleGroup :model-value="controls.view" :options="VIEW_OPTIONS" @update:model-value="updateControl('view', $event)" />
            <ControlToggleGroup :model-value="controls.mode" :options="modeOptions" @update:model-value="updateControl('mode', $event)" />
          </div>
        </ControlSection>

        <ControlSection title="Label">
          <ControlToggleGroup :model-value="controls.labelMode" :options="LABEL_OPTIONS" @update:model-value="updateControl('labelMode', $event)" />
        </ControlSection>

        <ControlSection title="Scale">
          <ControlSwitch v-if="controls.view === 'bars'" label="Log X" :model-value="controls.logX" @update:model-value="updateControl('logX', $event)" />
          <span v-else class="text-[10px] text-muted">N/A in bubbles view</span>
        </ControlSection>

        <ControlSection title="Overlay">
          <div :title="hasSingletons ? '' : 'No singletons in this graph'">
            <ControlBoolean
              label="Hide singletons"
              :model-value="controls.hideSingletons"
              :disabled="!hasSingletons"
              @update:model-value="hasSingletons && updateControl('hideSingletons', $event)"
            />
          </div>
        </ControlSection>

        <ControlSection v-if="filterAvailable" title="Filter" :col-span="2">
          <template #actions>
            <div class="flex items-center gap-2">
              <ControlToggleGroup :model-value="controls.filterMode" :options="FILTER_OPTIONS" @update:model-value="updateControl('filterMode', $event)" />
              <span class="text-[10px] text-muted tabular-nums">{{ displayedComponents.length }} shown</span>
              <button
                v-if="filterActive"
                class="text-[10px] text-muted hover:text-red-400"
                @click="clearFilter"
              >clear</button>
            </div>
          </template>

          <div v-if="controls.filterMode === 'range'" class="px-2 pt-1 pb-3">
            <Slider
              v-model="sliderModel"
              :min="sizeBounds.min"
              :max="sizeBounds.max"
              :tooltips="true"
              :lazy="false"
              class="size-slider"
            />
          </div>

          <div v-else class="flex items-center gap-3 text-[10px] text-secondary">
            <label class="flex items-center gap-1">
              <span class="text-muted">Top</span>
              <input
                type="number" :min="1" :max="componentCount"
                placeholder="–"
                :value="controls.rankTop ?? ''"
                class="input-base w-14 px-1.5 py-0.5 text-right tabular-nums"
                @input="updateControl('rankTop', $event.target.value === '' ? null : Math.max(1, Number($event.target.value)))"
              />
            </label>
            <label class="flex items-center gap-1">
              <span class="text-muted">Bottom</span>
              <input
                type="number" :min="1" :max="componentCount"
                placeholder="–"
                :value="controls.rankBottom ?? ''"
                class="input-base w-14 px-1.5 py-0.5 text-right tabular-nums"
                @input="updateControl('rankBottom', $event.target.value === '' ? null : Math.max(1, Number($event.target.value)))"
              />
            </label>
            <span class="text-muted text-[10px] ml-auto">of {{ componentCount }}</span>
          </div>
        </ControlSection>
      </div>
    </Teleport>

    <div v-if="loading" class="text-sm text-secondary p-3 surface-recessed rounded-lg">Loading components…</div>
    <div v-if="error" class="text-sm text-red-600 p-3 bg-red-50 rounded-lg border border-red-200">{{ error }}</div>

    <div :class="widened && selectedComponent ? 'grid grid-cols-2 gap-6' : ''">
      <div ref="mainContainer" class="chart-elev w-full min-w-0" style="aspect-ratio: 4/3; position: relative;"></div>
      <div v-if="widened && selectedComponent" class="flex flex-col min-w-0">
        <div ref="drillContainer" class="chart-elev w-full min-w-0 h-full" style="position: relative;"></div>
      </div>
    </div>

    <p class="text-[10px] leading-tight text-muted px-1">
      Components computed on the full graph; bubble/bar areas reflect the current active subset.
    </p>

  </div>
</template>

<style>
.size-slider {
  --slider-bg: #e2e8f0;
  --slider-connect-bg: #0ea5e9;
  --slider-height: 4px;
  --slider-handle-bg: #0ea5e9;
  --slider-handle-border: 2px solid #fff;
  --slider-handle-shadow: 0 1px 2px rgba(0, 0, 0, 0.15);
  --slider-handle-width: 14px;
  --slider-handle-height: 14px;
  --slider-tooltip-bg: #0ea5e9;
  --slider-tooltip-color: #fff;
  --slider-tooltip-font-size: 10px;
  --slider-tooltip-py: 2px;
  --slider-tooltip-px: 6px;
}
</style>
