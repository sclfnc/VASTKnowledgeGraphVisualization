<script setup>
import { ref, onMounted, watch, toRef } from 'vue'
import * as d3 from 'd3'
import { useMetrics } from '@/composables/useMetrics'
import { createHistogram, MARGINS, FORMATTERS, COLOR_SCHEME } from './shared.js'
import { PANEL_PROPS } from './panelProps.js'
import { usePanel } from './usePanel.js'
import PanelShell from './PanelShell.vue'

const props = defineProps(PANEL_PROPS)

// Legacy data path — useMetrics + /metrics/{graph_id}.
// Will be replaced by useGraphData + useFilterMask in Phase 3 of todo.md.
const { metrics: data, loading, error } = useMetrics(toRef(props, 'graphId'))

const { ownSpec, controls, explanation, updateControl } = usePanel(props, 'degree', data)

const chartContainer = ref(null)

onMounted(() => renderChart())
watch(() => [controls.value, data.value], renderChart, { deep: true })

function renderChart() {
  if (!chartContainer.value || !data.value?.degree_sequence) return

  d3.select(chartContainer.value).selectAll('*').remove()

  const width = chartContainer.value.clientWidth || 800
  const height = 400
  const m = MARGINS.standard
  const innerW = width - m.left - m.right
  const innerH = height - m.top - m.bottom

  const svg = d3.select(chartContainer.value).append('svg').attr('width', width).attr('height', height)
  const g = svg.append('g').attr('transform', `translate(${m.left},${m.top})`)

  const degreeData = data.value.degree_sequence
  const bins = controls.value.binning === 'exact' ? degreeData.length : 30
  const histogram = createHistogram(degreeData, bins)

  const useLogX = controls.value.scale === 'log-x' || controls.value.scale === 'log-log'
  const useLogY = controls.value.scale === 'log-y' || controls.value.scale === 'log-log'

  const xScale = useLogX
    ? d3.scaleLog().domain([Math.max(0.1, d3.min(histogram, d => d.x0)), d3.max(histogram, d => d.x1)]).range([0, innerW])
    : d3.scaleLinear().domain([0, d3.max(histogram, d => d.x1)]).range([0, innerW])

  const yMax = d3.max(histogram, d => d.count)
  const yScale = useLogY
    ? d3.scaleLog().domain([1, yMax]).range([innerH, 0]).clamp(true)
    : d3.scaleLinear().domain([0, yMax]).range([innerH, 0])

  g.selectAll('.bar')
    .data(histogram).join('rect')
    .attr('class', 'bar')
    .attr('x', d => xScale(Math.max(0.1, d.x0)))
    .attr('width', d => Math.max(0, xScale(d.x1) - xScale(Math.max(0.1, d.x0)) - 1))
    .attr('y', d => yScale(d.count))
    .attr('height', d => innerH - yScale(d.count))
    .attr('fill', COLOR_SCHEME.accent)
    .attr('opacity', 0.7)
    .on('mouseover', function () { d3.select(this).attr('opacity', 1) })
    .on('mouseout', function () { d3.select(this).attr('opacity', 0.7) })

  if (controls.value.showBaseline && data.value.er_baseline) {
    const erHist = createHistogram(data.value.er_baseline, 30)
    const erLine = d3.line()
      .x(d => xScale(Math.max(0.1, (d.x0 + d.x1) / 2)))
      .y(d => yScale(d.count))

    g.append('path').datum(erHist)
      .attr('fill', 'none').attr('stroke', '#ef4444').attr('stroke-width', 2)
      .attr('stroke-dasharray', '4,4').attr('opacity', 0.6).attr('d', erLine)

    g.append('line')
      .attr('x1', innerW - 150).attr('y1', 10).attr('x2', innerW - 120).attr('y2', 10)
      .attr('stroke', '#ef4444').attr('stroke-width', 2).attr('stroke-dasharray', '4,4')
    g.append('text')
      .attr('x', innerW - 110).attr('y', 15).attr('font-size', '12px').attr('fill', '#666')
      .text('ER Baseline')
  }

  g.append('g').attr('transform', `translate(0,${innerH})`).call(d3.axisBottom(xScale))
    .append('text')
    .attr('x', innerW / 2).attr('y', 40).attr('fill', '#333')
    .attr('font-size', '14px').attr('text-anchor', 'middle').text('Degree (k)')

  g.append('g').call(d3.axisLeft(yScale))
    .append('text')
    .attr('transform', 'rotate(-90)')
    .attr('x', -innerH / 2).attr('y', -40).attr('fill', '#333')
    .attr('font-size', '14px').attr('text-anchor', 'middle').text('Count')

  const stats = data.value.degree_stats || {}
  g.append('text')
    .attr('x', innerW - 10).attr('y', -5).attr('text-anchor', 'end')
    .attr('font-size', '12px').attr('fill', '#666')
    .text(`μ=${FORMATTERS.number(stats.mean || 0)} σ=${FORMATTERS.number(stats.std || 0)}`)
}
</script>

<template>
  <PanelShell
    :explanation="explanation"
    :controls-schema="ownSpec?.controlsSchema"
    :controls="controls"
    :show-explanation="showExplanation"
    @update="updateControl"
  >
    <div v-if="loading" class="text-sm text-slate-500 p-3 bg-slate-50 rounded">Loading metrics…</div>
    <div v-if="error" class="text-sm text-red-600 p-3 bg-red-50 rounded border border-red-200">{{ error }}</div>
    <div ref="chartContainer" class="w-full bg-white rounded border border-slate-200" style="height: 400px;"></div>
  </PanelShell>
</template>
