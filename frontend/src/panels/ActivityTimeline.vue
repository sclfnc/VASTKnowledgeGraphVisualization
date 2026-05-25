<script setup>
import { ref, computed, toRef, watch, nextTick } from 'vue'
import * as d3 from 'd3'
import { Clock, Settings } from 'lucide-vue-next'

import { useTimeline } from '@/composables/useTimeline.js'
import { useNodeTypeColors } from '@/composables/useNodeTypeColors.js'
import { useFiltersStore } from '@/stores/filters.js'
import { useTimelineSettingsModal } from '@/composables/useTimelineSettingsModal.js'
import { usePanel } from './usePanel.js'
import { useD3Chart } from './useD3Chart.js'
import { makeTooltip, showTip, hideTip, visibleSubset, svgFrame, FORMATTERS } from './shared.js'
import ControlSection from './controls/ControlSection.vue'
import ControlToggleGroup from './controls/ControlToggleGroup.vue'

const props = defineProps({
  panelSpec: { type: Object, required: true },
  schema: { type: Object, default: null },
  graphId: { type: String, default: null },
  widened: { type: Boolean, default: false },
  controlsTarget: { type: String, default: null },
})

defineEmits(['request-widen', 'request-shrink'])

const { data, loading, error } = useTimeline(toRef(props, 'graphId'))
const { color: typeColor } = useNodeTypeColors(toRef(props, 'schema'))
const filters = useFiltersStore()
const { openTimelineSettings } = useTimelineSettingsModal()
const { controls, updateControl } = usePanel(props, 'timeline', data)

const chartContainer = ref(null)
let tooltip = null

const MARGINS = { top: 12, right: 16, bottom: 34, left: 50 }

const BREAKDOWN_OPTIONS = [
  { k: 'type', label: 'By Type' },
  { k: 'none', label: 'None' },
]
const BIN_OPTIONS = [
  { k: 'year', label: 'Year' },
  { k: 'decade', label: 'Decade' },
]

const activeAttr = computed(() => controls.value.attr || data.value?.temporal_attrs?.[0] || null)
const activeAttrData = computed(() => activeAttr.value ? data.value?.per_attr?.[activeAttr.value] : null)
const activeBins = computed(() => {
  const a = activeAttrData.value
  if (!a) return []
  return controls.value.binSize === 'decade' ? (a.bins_decade || []) : (a.bins || [])
})

const isEmpty = computed(() => !loading.value && data.value && (data.value.temporal_attrs?.length ?? 0) === 0)
const isNoValid = computed(() => !loading.value && activeAttrData.value && activeAttrData.value.valid_count === 0)

const coverageText = computed(() => {
  const a = activeAttrData.value
  if (!a) return ''
  const pct = a.eligible_nodes ? ((a.valid_count / a.eligible_nodes) * 100).toFixed(0) : '?'
  return `${a.valid_count.toLocaleString()} / ${a.eligible_nodes.toLocaleString()} valid (${pct}%) · strategy: ${a.parse_strategy} · failures: ${a.parse_failures}`
})
const coverageTooltipText = computed(() => {
  const a = activeAttrData.value
  if (!a) return ''
  return `Of ${a.total_nodes.toLocaleString()} total nodes, ${a.eligible_nodes.toLocaleString()} carry this attribute; ${a.valid_count.toLocaleString()} parsed via ${a.parse_strategy}; ${a.parse_failures.toLocaleString()} unparseable values discarded.`
})

function render() {
  if (!chartContainer.value) return
  d3.select(chartContainer.value).selectAll('*').remove()
  if (!data.value || !activeAttrData.value || activeBins.value.length === 0) return

  const bins = activeBins.value
  const { totalW, totalH, innerW, innerH } = svgFrame(chartContainer.value, MARGINS, { minInner: 50 })

  const svg = d3.select(chartContainer.value).append('svg')
    .attr('width', totalW).attr('height', totalH)
  if (!tooltip) tooltip = makeTooltip(chartContainer.value)

  const g = svg.append('g').attr('transform', `translate(${MARGINS.left},${MARGINS.top})`)

  // Bars sum only globally-visible types.
  const types = visibleSubset(filters.nodeTypes, props.schema?.node_types ?? [])
  const visibleTotal = b => {
    if (!types.length) return b.total
    let s = 0
    for (const t of types) s += b.by_type?.[t] || 0
    return s
  }

  const xScale = d3.scaleBand().domain(bins.map(b => b.year)).range([0, innerW]).padding(0.1)
  const maxTotal = d3.max(bins, b => visibleTotal(b)) || 1
  const yScale = d3.scaleLinear().domain([0, maxTotal]).range([innerH, 0])

  const maxXTicks = 10
  const step = Math.max(1, Math.ceil(bins.length / maxXTicks))
  const tickValues = bins.map(b => b.year).filter((_, i) => i % step === 0)
  g.append('g').attr('transform', `translate(0,${innerH})`)
    .call(d3.axisBottom(xScale).tickValues(tickValues).tickFormat(d => String(d)))
    .selectAll('text').attr('font-size', 10).attr('fill', '#64748b')

  g.append('g').call(d3.axisLeft(yScale).ticks(5).tickFormat(FORMATTERS.siCompact))
    .selectAll('text').attr('font-size', 10).attr('fill', '#64748b')

  svg.append('text')
    .attr('x', MARGINS.left + innerW / 2)
    .attr('y', totalH - 4)
    .attr('text-anchor', 'middle').attr('font-size', 11).attr('fill', '#475569')
    .text(activeAttr.value)

  if (controls.value.breakdown === 'type' && types.length > 0) {
    // Tidy stack input: one row per bin keyed by type.
    const rows = bins.map(b => {
      const row = { year: b.year, total: b.total }
      for (const t of types) row[t] = b.by_type?.[t] || 0
      return row
    })
    const series = d3.stack().keys(types)(rows)
    g.selectAll('g.layer').data(series).join('g').attr('class', 'layer')
      .attr('fill', d => typeColor(d.key))
      .selectAll('rect').data(d => d).join('rect')
      .attr('x', d => xScale(d.data.year))
      .attr('y', d => yScale(d[1]))
      .attr('height', d => yScale(d[0]) - yScale(d[1]))
      .attr('width', xScale.bandwidth())
      .attr('opacity', 0.9)
      .style('cursor', 'pointer')
      .on('mouseover', (ev, d) => showTip(tooltip, ev, binTooltip(d.data)))
      .on('mousemove', (ev) => showTip(tooltip, ev, null))
      .on('mouseout', () => hideTip(tooltip))
      .on('click', (_, d) => onBarClick(d.data.year))
  } else {
    g.selectAll('rect.bar').data(bins).join('rect').attr('class', 'bar')
      .attr('x', d => xScale(d.year))
      .attr('y', d => yScale(visibleTotal(d)))
      .attr('width', xScale.bandwidth())
      .attr('height', d => innerH - yScale(visibleTotal(d)))
      .attr('fill', '#0284c7')
      .attr('opacity', 0.9)
      .style('cursor', 'pointer')
      .on('mouseover', (ev, d) => showTip(tooltip, ev, binTooltip(d)))
      .on('mousemove', (ev) => showTip(tooltip, ev, null))
      .on('mouseout', () => hideTip(tooltip))
      .on('click', (_, d) => onBarClick(d.year))
  }

  const brush = d3.brushX()
    .extent([[0, 0], [innerW, innerH]])
    .on('end', (event) => {
      if (!event.selection) {
        filters.temporalFilter = null
        return
      }
      const [x0, x1] = event.selection
      const yearsInRange = bins
        .filter(b => {
          const left = xScale(b.year)
          const right = left + xScale.bandwidth()
          return right >= x0 && left <= x1
        })
        .map(b => b.year)
      if (!yearsInRange.length) {
        filters.temporalFilter = null
        return
      }
      const lo = yearsInRange[0]
      const hi = yearsInRange[yearsInRange.length - 1]
      filters.temporalFilter = { attr: activeAttr.value, range: [lo, hi] }
    })

  g.append('g').attr('class', 'brush').call(brush)
}

function binTooltip(b) {
  const lines = [`<b>${b.year}</b>: ${b.total.toLocaleString()}`]
  const entries = Object.entries(b.by_type || {}).sort((a, c) => c[1] - a[1])
  for (const [t, c] of entries) {
    lines.push(`<span style="color:${typeColor(t)}">●</span> ${t}: ${c.toLocaleString()}`)
  }
  return lines.join('<br>')
}

function onBarClick(year) {
  filters.temporalFilter = { attr: activeAttr.value, range: [year, year] }
}

watch([data, controls, () => props.widened, () => filters.nodeTypes], () => nextTick(render), { deep: true })
useD3Chart(chartContainer, render)
</script>

<template>
  <div class="flex flex-col gap-1.5">
    <Teleport v-if="controlsTarget && data?.temporal_attrs?.length" :to="`#${controlsTarget}`">
      <div class="grid grid-cols-2 auto-rows-min gap-1.5">
        <ControlSection title="Attribute" :col-span="2">
          <select
            class="input-base w-full text-xs px-2 py-1"
            :value="controls.attr ?? data.temporal_attrs[0]"
            @change="(e) => updateControl('attr', e.target.value)"
          >
            <option v-for="a in data.temporal_attrs" :key="a" :value="a">{{ a }}</option>
          </select>
        </ControlSection>

        <ControlSection title="Breakdown">
          <ControlToggleGroup
            :model-value="controls.breakdown"
            :options="BREAKDOWN_OPTIONS"
            @update:model-value="updateControl('breakdown', $event)"
          />
        </ControlSection>

        <ControlSection title="Bin size">
          <ControlToggleGroup
            :model-value="controls.binSize"
            :options="BIN_OPTIONS"
            @update:model-value="updateControl('binSize', $event)"
          />
        </ControlSection>

        <ControlSection title="Parsing" :col-span="2">
          <button class="inline-flex items-center gap-1 text-[11px] text-sky-600 hover:underline"
                  @click="openTimelineSettings">
            <Settings :size="12" />
            Customize date parsing…
          </button>
          <p v-if="activeAttrData" class="text-[10px] text-muted mt-1">
            Strategy: <code>{{ activeAttrData.parse_strategy }}</code> · {{ activeAttrData.parse_failures }} failures
          </p>
        </ControlSection>
      </div>
    </Teleport>

    <div v-if="loading" class="text-sm text-secondary p-3 surface-recessed rounded-lg">Loading timeline…</div>
    <div v-if="error" class="text-sm text-red-600 p-3 bg-red-50 rounded-lg border border-red-200">{{ error }}</div>

    <div v-if="!loading && !error" class="flex flex-col gap-1">
      <div
        v-if="isEmpty"
        class="flex flex-col items-center justify-center gap-2 surface-recessed rounded-lg p-6 text-sm text-secondary"
        style="aspect-ratio: 4/3;"
      >
        <Clock :size="36" class="text-muted" />
        <p class="text-center">No temporal data in this graph.</p>
      </div>

      <div
        v-else-if="isNoValid"
        class="flex flex-col items-center justify-center gap-2 surface-recessed rounded-lg p-6 text-sm text-secondary"
        style="aspect-ratio: 4/3;"
      >
        <Clock :size="36" class="text-muted" />
        <p class="text-center">No parseable values for <code>{{ activeAttr }}</code> (strategy: <code>{{ activeAttrData?.parse_strategy }}</code>).</p>
        <button class="text-[11px] text-sky-600 hover:underline" @click="openTimelineSettings()">Open settings to adjust…</button>
      </div>

      <template v-else>
        <p v-if="activeAttrData" class="text-[10px] text-muted leading-tight" :title="coverageTooltipText">
          {{ coverageText }}
        </p>
        <div ref="chartContainer" class="chart-elev w-full min-w-0" style="aspect-ratio: 4/3; position: relative;"></div>
        <p class="text-[10px] leading-tight text-muted px-1">
          Bins parsed on the full graph; current filter hides type segments (and rescales totals accordingly).
        </p>
      </template>
    </div>
  </div>
</template>
