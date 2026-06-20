<script setup>
import { ref, toRef, watch, nextTick, computed } from 'vue'
import * as d3 from 'd3'
import { usePanel } from './usePanel.js'
import { useD3Chart } from './useD3Chart.js'
import ControlSection from './controls/ControlSection.vue'
import ControlToggleGroup from './controls/ControlToggleGroup.vue'
import { FALLBACK_COLOR } from './shared.js'
import { injectGraphEdges } from '@/composables/useGraphEdges.js'
import { usePanelContextFromProps } from '@/composables/usePanelContext.js'
import { useEffectiveType } from '@/composables/useEffectiveType.js'
import { useFiltersStore } from '@/stores/filters.js'

const props = defineProps({
  panelSpec: { type: Object, required: true },
  schema: { type: Object, default: null },
  graphId: { type: String, default: null },
  widened: { type: Boolean, default: false },
  controlsTarget: { type: String, default: null },
})

defineEmits(['request-widen', 'request-shrink'])

const filters = useFiltersStore()
const { edges } = injectGraphEdges(toRef(props, 'graphId'))
const { activeEdgeMask } = usePanelContextFromProps(props)
const { edgeTypeAt } = useEffectiveType(toRef(props, 'graphId'), toRef(props, 'schema'))
const { controls, updateControl } = usePanel(props, props.panelSpec?.id, props.schema)

controls.value.view = 'all'
const VIEW_OPTIONS = [
  { k: 'all', label: 'Entire Graph' },
  { k: 'selection', label: 'Current Selection' },
]
const MARGINS = { top: 8, right: 12, bottom: 38, left: 44 }

const edgeTypeCounts = computed(() => {
  if (!props.schema) return []
  return props.schema.edge_types_detail
})

const currentEdgeTypeCounts = computed(() => {
  const soa = edges.value
  const mask = activeEdgeMask.value
  if (!soa || !mask) return []
  const counts = {}
  if (props.schema) props.schema.edge_types.forEach(type => {
    counts[type] = 0
  });
  for (let i = 0; i < soa.E; i++) {
    if (!mask.get(i)) continue
    const type = edgeTypeAt(i) ?? soa.edgeTypes[soa.type[i]]
    counts[type] = (counts[type] || 0) + 1
  }
  return Object.entries(counts).map(([k, v]) => ({ name: k, count: v }))
})

function handleClickOnEdgeBar(e, d) {
  e.stopPropagation()
  if (e.ctrlKey || e.metaKey) {
    toggleEdgeType(d.name)

  } else {
    selectEdgeType(d.name)
  }

}

function toggleEdgeType(t) {
  filters.edgeTypes = filters.edgeTypes.includes(t)
    ? filters.edgeTypes.filter(x => x !== t)
    : [...filters.edgeTypes, t]
}

function selectEdgeType(t) {
  filters.edgeTypes = [t]
}

function clearEdgeTypeFilter() {
  filters.edgeTypes = props.schema?.edge_types ?? []
}


const containerRef = ref(null)

function render() {
  const totalW = containerRef.value.clientWidth || 800
  const totalH = containerRef.value.clientHeight || Math.round(totalW * 3 / 4)
  const innerW = Math.max(0, totalW - MARGINS.left - MARGINS.right)
  const innerH = Math.max(0, totalH - MARGINS.top - MARGINS.bottom)
  if (innerW < 50 || innerH < 50) return // card too narrow to render meaningfully

  const svg = d3.select(containerRef.value).select('svg')
    .attr('width', totalW)
    .attr('height', totalH)
    .select('g')
    .attr('transform', `translate(${MARGINS.left}, ${MARGINS.top})`)

  // Order of bars always tethered to counts for full graph in descending order
  const barchart = BarChart()
    .size([innerW, innerH])
    .fontSize(10)
    .scaleBandDomain(edgeTypeCounts.value
      .toSorted((a, b) => d3.descending(a.count, b.count))
      .map(d => d.name)
    )

  svg.datum(
    controls.value.view === 'all'
      ? edgeTypeCounts.value
      : currentEdgeTypeCounts.value
  ).call(barchart)
}


function BarChart() {
  var size = [300, 300];
  var fontFamily = 'sans-serif';
  var fontSize = 10;
  var labelPadding = 3;
  var barHeight = 25;
  var scaleBandDomain;

  function my(selection) {
    const yScale = d3.scaleBand()
      .domain(scaleBandDomain ?? selection.datum().map(d => d.name))
      .range([0, Math.min(size[1], selection.datum().length * barHeight)])
      .paddingInner(.2)

    const xScale = d3.scaleLinear()
      .domain([0, Math.max(d3.max(selection.datum(), d => d.count), 1)])
      .range([1, size[0]]);


    let gs = selection.selectAll("g.bar")
      .data(selection.datum(), d => d.name)
      .join("g")
      .attr('font-family', fontFamily)
      .attr('font-size', fontSize)
      .classed('bar', true)
      .on('click', handleClickOnEdgeBar)
      .attr('transform', d => `translate(0, ${yScale(d.name)})`);

    gs.selectAll('rect')
      .data(d => [d])
      .join('rect')
      .attr("height", yScale.bandwidth())
      .attr('fill', FALLBACK_COLOR)
      .attr("stroke", d => filters.edgeTypes.includes(d.name) ? '#0f172a' : 'none')
      .attr("stroke-width", d => filters.edgeTypes.includes(d.name) ? 1.5 : 0)
      .attr("width", d => xScale(d.count))

    gs.selectAll('text')
      .data(d => [d])
      .join('text')
      .text(d => `${d.name}: ${d.count}`)
      .attr('dominant-baseline', 'middle')
      .attr('text-anchor', d => xScale(d.count) > size[0] / 2 ? 'end' : 'start')
      .attr('fill', 'black')
      .attr('y', yScale.bandwidth() / 2)
      .attr('transform', d => `translate(${xScale(d.count) > size[0] / 2 ? xScale(d.count) - labelPadding : xScale(d.count) + labelPadding}, 0)`)
  }

  my.size = function (value) {
    if (!arguments.length) return size;
    size = value;
    return my;
  }

  my.fontSize = function (value) {
    if (!arguments.length) return fontSize;
    fontSize = value;
    return my;
  }

  my.fontFamily = function (value) {
    if (!arguments.length) return fontFamily;
    fontFamily = value;
    return my;
  }

  my.labelPadding = function (value) {
    if (!arguments.length) return labelPadding;
    labelPadding = value;
    return my;
  }

  my.barHeight = function (value) {
    if (!arguments.length) return barHeight
    barHeight = value;
    return my
  }

  my.scaleBandDomain = function (value) {
    if (!arguments.length) return scaleBandDomain
    scaleBandDomain = value
    return my
  }

  return my;
}

watch([controls, edgeTypeCounts, activeEdgeMask], () => nextTick(render), { deep: true })
useD3Chart(containerRef, render)
</script>

<template>
  <div>
    <Teleport v-if="controlsTarget" :to="`#${controlsTarget}`">
      <div class="grid grid-cols-2 auto-rows-min gap-1.5">
        <ControlSection title="View" :col-span="2">
          <ControlToggleGroup :model-value="controls.view" :options="VIEW_OPTIONS"
            @update:model-value="updateControl('view', $event)"></ControlToggleGroup>
        </ControlSection>
      </div>
    </Teleport>
    <div ref="containerRef" class="chart-elev w-full"
      style="aspect-ratio: 4/3; position: relative;">
      <svg v-on:click="clearEdgeTypeFilter">
        <g></g>
      </svg>
    </div>
  </div>
</template>

<style scoped>
:deep(svg > g *) {
  transition: all 1500ms,
    font-weight 150ms,
    stroke-width 150ms;
  cursor: pointer;
}

:deep(g.bar:hover) {
  font-weight: bold;
}
</style>