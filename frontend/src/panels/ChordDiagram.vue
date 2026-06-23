<script setup>
import { ref, toRef, watch, nextTick, computed } from 'vue'
import * as d3 from 'd3'
import { usePanel } from './usePanel.js'
import { useD3Chart } from './useD3Chart.js'
import { injectGraphEdges } from '@/composables/useGraphEdges.js'
import { usePanelContextFromProps } from '@/composables/usePanelContext.js'
import { useEffectiveType } from '@/composables/useEffectiveType.js'
import { useNodeTypeColors } from '@/composables/useNodeTypeColors.js'
import { useFiltersStore } from '@/stores/filters.js'
import { SLATE, radiansToDegrees } from './shared.js'

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
const { nodeTypeAt } = useEffectiveType(toRef(props, 'graphId'), toRef(props, 'schema'))
const { controls } = usePanel(props, props.panelSpec?.id, props.schema)
const { color: colorScale } = useNodeTypeColors(toRef(props, 'schema'))


const MARGINS = { top: 15, right: 15, bottom: 15, left: 15 }

const edgeAgg = computed(() => {
  const adjMatrix = []
  const nodes = []
  const bySource = new Map()

  const soa = edges.value
  const mask = activeEdgeMask.value
  if (!soa || !mask) return { nodes: [], adjMatrix }

  for (let i = 0; i < soa.E; i++) {
    if (!mask.get(i)) continue
    const sourceType = nodeTypeAt(soa.source[i])
    const targetType = nodeTypeAt(soa.target[i])
    nodes.push(sourceType)
    nodes.push(targetType)

    let byTarget = bySource.get(sourceType)
    if (!byTarget) { byTarget = new Map(); bySource.set(sourceType, byTarget) }
    byTarget.set(targetType, (byTarget.get(targetType) || 0) + 1)

    if (sourceType !== targetType) {
      byTarget = bySource.get(targetType)
      if (!byTarget) { byTarget = new Map(); bySource.set(targetType, byTarget) }
      byTarget.set(sourceType, (byTarget.get(sourceType) || 0) + 1)
    }


  }
  for (let source of new Set(nodes)) {
    let row = []
    for (let target of new Set(nodes)) {
      row.push(bySource.get(source).get(target) ?? 0)
    }
    adjMatrix.push(row)
  }

  return { nodes: [... new Set(nodes)], adjMatrix }
})


function handleNodeClick(e, d) {
  e.stopPropagation()
  if (filters.sourceType) {
    filterTargetType(d.name)
  }
  else filterSourceType(d.name)
}

function handleLinkClick(e, d) {
  e.stopPropagation()
  filterSourceType(d.sourceName)
  filterTargetType(d.targetName)
}

function filterSourceType(t) {
  filters.sourceType = t
}

function filterTargetType(t) {
  filters.targetType = t
}

function clearFilters() {
  filters.sourceType = null
  filters.targetType = null
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

  const innerChart = svg
    .select('g')
    .attr('transform', `translate(${totalW / 2}, ${totalH / 2})`)

  if (!edgeAgg.value.nodes.length) {
    // Clear inner Chart content and put warning message in the correct position
    innerChart.selectAll('*').remove()
    svg.select('text#message').attr('x', totalW / 2).attr('y', totalH / 2)

    return
  }
  const chordgraph = chordGraph()
    .size([innerW, innerH])
    .fontSize(10)
    .colorScale(colorScale)
    .nodeWidth(10)
    .padAngle(0.2)

  innerChart.datum(edgeAgg.value).call(chordgraph)

}

function chordGraph() {
  var size = [300, 300];
  var colorScale = d3.scaleOrdinal(d3.schemeObservable10);
  var nodeWidth = 15;
  var padAngle = 0;
  var fontSize = 10;
  var fontFamily = 'sans-serif';
  var labelPadding = 7;

  function my(selection) {
    const outerRadius = Math.min(size[0], size[1]) / 2
    const innerRadius = outerRadius - nodeWidth

    const matrix = selection.datum().adjMatrix
    const nodeList = selection.datum().nodes
    const total = d3.sum(matrix.map(row => d3.sum(row)))

    // Scale real values in order to ensure that all paths are visible
    const scale = d3.scaleLinear()
      .domain([0, total])
      .range([1, 2 * innerRadius])

    const scaledMatrix = matrix.map(row =>
      row.map(value => value > 0 ? scale(value) : value)
    )

    const chord = d3.chord().padAngle(padAngle)
      .sortSubgroups(d3.descending)(scaledMatrix)


    // Annotate links and nodes with ids for better transitions
    chord.forEach(d => {
      d.name = `${nodeList[d.source.index]} - ${nodeList[d.target.index]}`
      d.sourceName = nodeList[d.source.index]
      d.targetName = nodeList[d.target.index]
      // annotate with non-scaled value for label
      d.count = matrix[d.source.index][d.target.index]
      d.midstart = d.source.startAngle + (d.source.endAngle - d.source.startAngle) / 2
      d.midend = d.target.startAngle + (d.target.endAngle - d.target.startAngle) / 2
    });
    chord.groups.forEach(d => {
      d.name = nodeList[d.index]
      d.midpoint = d.startAngle + (d.endAngle - d.startAngle) / 2
    });

    selection
      .attr('font-family', fontFamily)
      .attr('font-size', fontSize)


    const grads = selection.selectAll('defs')
      .data([chord.filter(d => d.source.index != d.target.index)])
      .join('defs')
      .selectAll('linearGradient')
      .data(d => d)
      .join('linearGradient')
      .attr('id', d => `${d.source.index}-${d.target.index}`)
      .attr('gradientUnits', 'userSpaceOnUse')
      .attr('x1', d => Math.sin(d.midstart) * innerRadius)
      .attr('y1', d => -1 * Math.cos(d.midstart) * innerRadius)
      .attr('x2', d => Math.sin(d.midend) * innerRadius)
      .attr('y2', d => -1 * Math.cos(d.midend) * innerRadius)

    grads.selectAll('stop')
      .data(d => [
        { offset: "0%", stopColor: colorScale(nodeList[d.source.index]) },
        { offset: "100%", stopColor: colorScale(nodeList[d.target.index]) }
      ])
      .join('stop')
      .attr('offset', d => d.offset)
      .attr('stop-color', d => d.stopColor)

    const links = selection
      .selectAll('g.chord_links')
      .data([chord])
      .join('g')
      .classed('chord_links', true)
      .selectAll('g.link')
      .data(d => d, d => d.name)
      .join('g')
      .attr('fill', d => d.source.index == d.target.index
        ? colorScale(nodeList[d.source.index])
        : `url(#${d.source.index}-${d.target.index})`)
      .classed('link', true)
      .on('click', handleLinkClick)

    links.selectAll('path')
      .data(d => [d])
      .join('path')
      .attr('d', d3.ribbon().radius(outerRadius - nodeWidth))

    links.selectAll('title')
      .data(d => [d])
      .join('title')
      .text(d => `${d.name}: ${d.count}`)

    const nodes = selection.selectAll('g.chord_nodes')
      .data([chord.groups])
      .join('g')
      .classed('chord_nodes', true)
      .selectAll('g.node')
      .data(d => d, d => d.name)
      .join('g')
      .classed('node', true)
      .classed('clicked', d => d.name === filters.sourceType
        || d.name === filters.targetType
      )
      .on('click', handleNodeClick)

    nodes.selectAll('path')
      .data(d => [d])
      .join('path')
      .attr('d', d3.arc()
        .innerRadius(outerRadius - nodeWidth)
        .outerRadius(outerRadius))
      .attr('stroke', '#0f172a')
      .attr('stroke-width', 1.5)
      .attr('fill', d => colorScale(nodeList[d.index]))

    nodes.selectAll('text')
      .data(d => [d])
      .join('text')
      .attr('transform', d => `translate(
        ${Math.sin(d.midpoint) * (outerRadius + labelPadding)},
        ${-1 * Math.cos(d.midpoint) * (outerRadius + labelPadding)}
        )
        rotate(${d.midpoint <= Math.PI / 2 ||
          d.midpoint >= Math.PI * 3 / 2
          ? radiansToDegrees(d.midpoint)
          : radiansToDegrees(d.midpoint) - 180
        })`)
      .attr('dominant-baseline', 'middle')
      .attr('text-anchor', 'middle')
      .text(d => d.name)

  }

  // Getters and setters
  my.size = function (value) {
    if (!arguments.length) return size
    size = value
    return my
  }

  my.colorScale = function (value) {
    if (!arguments.length) return colorScale
    colorScale = value
    return my
  }

  my.nodeWidth = function (value) {
    if (!arguments.length) return nodeWidth
    nodeWidth = value
    return my
  }

  my.padAngle = function (value) {
    if (!arguments.length) return padAngle
    padAngle = value
    return my
  }

  my.fontSize = function (value) {
    if (!arguments.length) return fontSize
    fontSize = value
    return my
  }

  my.fontFamily = function (value) {
    if (!arguments.length) return fontFamily
    fontFamily = value
    return my
  }

  return my
}

watch([controls, edgeAgg, activeEdgeMask], () => nextTick(render), { deep: true })
useD3Chart(containerRef, render)
</script>

<template>
  <div>
    <Teleport v-if="controlsTarget" :to="`#${controlsTarget}`">
      <div class="grid grid-cols-2 auto-rows-min gap-1.5">
      </div>
    </Teleport>
    <div ref="containerRef" class="chart-elev w-full"
      style="aspect-ratio: 4/3; position: relative;">
      <svg @click="clearFilters">
        <g></g>
        <!-- Display message if no edges match the current filter -->
        <text v-if="!edgeAgg.nodes.length" id="message" text-anchor="middle" font-size="12" :fill="SLATE[400]">
          No edges match the current filters
        </text>
      </svg>
    </div>
  </div>
</template>

<style scoped>
:deep(g.link) {
  fill-opacity: .7;
}

:deep(g.node),
:deep(g.link) {
  cursor: pointer;
}

:deep(g.node) {
  stroke-opacity: 0;
  stroke-width: 0;
}

:deep(g.node:hover),
:deep(g.node.clicked) {
  stroke-opacity: 1;
  stroke-width: 1.5;
  font-weight: bold;
}

:deep(g.link:hover) {
  fill-opacity: .9;
}

:deep(svg > g *) {
  transition: all 1500ms,
    fill-opacity 150ms,
    stroke-opacity 150ms,
    font-weight 150ms;
}
</style>