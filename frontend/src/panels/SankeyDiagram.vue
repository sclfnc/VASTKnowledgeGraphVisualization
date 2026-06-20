<script setup>
import { ref, toRef, watch, nextTick, computed } from 'vue'
import * as d3 from 'd3'
import * as d3Sankey from 'd3-sankey'
import { usePanel } from './usePanel.js'
import { useD3Chart } from './useD3Chart.js'
import ControlSection from './controls/ControlSection.vue'
import ControlToggleGroup from './controls/ControlToggleGroup.vue'
import { injectGraphEdges } from '@/composables/useGraphEdges.js'
import { usePanelContextFromProps } from '@/composables/usePanelContext.js'
import { useEffectiveType } from '@/composables/useEffectiveType.js'
import { useNodeTypeColors } from '@/composables/useNodeTypeColors.js'

const props = defineProps({
  panelSpec: { type: Object, required: true },
  schema: { type: Object, default: null },
  graphId: { type: String, default: null },
  widened: { type: Boolean, default: false },
  controlsTarget: { type: String, default: null },
})

defineEmits(['request-widen', 'request-shrink'])

const { edges } = injectGraphEdges(toRef(props, 'graphId'))
const { activeEdgeMask } = usePanelContextFromProps(props)
const { nodeTypeAt } = useEffectiveType(toRef(props, 'graphId'), toRef(props, 'schema'))
const { controls, updateControl } = usePanel(props, props.panelSpec?.id, props.schema)
const { color: colorScale } = useNodeTypeColors(toRef(props, 'schema'))


controls.value.color = 'source'
const COLOR_OPTIONS = [
  { k: 'source', label: 'Source Type' },
  { k: 'target', label: 'Target Type' },
]
const MARGINS = { top: 8, right: 8, bottom: 8, left: 44 }

const edgeAgg = computed(() => {
  const sankeyLinks = []
  const sources = []
  const targets = []
  const bySource = new Map()

  const soa = edges.value
  const mask = activeEdgeMask.value
  if (!soa || !mask) return { nodes: [], links: sankeyLinks }

  for (let i = 0; i < soa.E; i++) {
    if (!mask.get(i)) continue
    const sourceType = nodeTypeAt(soa.source[i])
    const source = sourceType + '_s'
    const targetType = nodeTypeAt(soa.target[i])
    const target = targetType + '_t'
    sources.push(sourceType)
    targets.push(targetType)

    let byTarget = bySource.get(source)
    if (!byTarget) { byTarget = new Map(); bySource.set(source, byTarget) }
    byTarget.set(target, (byTarget.get(target) || 0) + 1)

  }
  for (const [st, byTarget] of bySource) {
    for (const [tt, count] of byTarget) {
      sankeyLinks.push({ source: st, target: tt, count })
    }
  }
  const sankeyNodes = [...new Set(sources)].map(name => ({ name, id: name + '_s' }))
    .concat([...new Set(targets)].map(name => ({ name, id: name + '_t' })))

  return { nodes: [... new Set(sankeyNodes)], links: sankeyLinks }
})


const containerRef = ref(null)

function render() {
  if (!edgeAgg.value.nodes.length || !edgeAgg.value.links.length) return
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

  const sankey = SankeyGraph()
    .size([innerW, innerH])
    .fontSize(10)
    .colorScale(colorScale)
    .nodeWidth(10)

  svg.datum(edgeAgg.value).call(sankey)

}


function SankeyGraph() {
  var size = [300, 300];
  var nodeWidth = 15;
  var nodePadding = 10;
  var labelPadding = 3;
  var fontFamily = 'sans-serif';
  var fontSize = 10;
  var colorScale = d3.scaleOrdinal(d3.schemeObservable10);

  function my(selection) {
    console.log('sankey diagram selection datum', selection.datum())
    const sankeyGenerator = d3Sankey.sankey()
      .nodeId(d => d.id)
      .nodeWidth(nodeWidth)
      .nodePadding(nodePadding)
      .size(size);

    const sankey = sankeyGenerator({
      nodes: selection.datum().nodes.map(d => ({ ...d })),
      links: selection.datum().links.map(d => ({ ...d, value: d.count }))
    });

    console.log(sankey)

    selection
      .attr('font-family', fontFamily)
      .attr('font-size', fontSize)


    const links = selection.selectAll('g.sankey_links')
      .data([sankey.links])
      .join('g')
      .classed('sankey_links', true)
      .selectAll('g.link')
      .data(d => d, d => `${d.source.id}-${d.target.id}`)
      .join('g')
      .classed('link', true)
      .attr('fill', 'transparent')

    links.selectAll('path')
      .data(d => [d])
      .join('path')
      .attr('stroke', d => controls.value.color == 'source'
        ? colorScale(d.source.name)
        : colorScale(d.target.name))
      .attr('stroke-width', d => Math.max(1, d.width))
      .attr('d', d3Sankey.sankeyLinkHorizontal())

    links.selectAll('title')
      .data(d => [d])
      .join('title')
      .text(d => `${d.source.name} → ${d.target.name}: ${d.value}`);

    const nodes = selection.selectAll('g.sankey_nodes')
      .data([sankey.nodes])
      .join('g')
      .classed('sankey_nodes', true)
      .selectAll('g.node')
      .data(d => d, d => d.id)
      .join('g')
      .classed('node', true)
      .attr('transform', d => `translate(${d.x0}, ${d.y0})`)

    nodes
      .selectAll('rect')
      .data(d => [d])
      .join('rect')
      .attr('fill', d => colorScale(d.name))
      .attr('stroke', '#0f172a')
      .attr('stroke-width', 1.5)
      .attr('width', d => d.x1 - d.x0)
      .attr('height', d => d.y1 - d.y0)

    nodes.selectAll('text')
      .data(d => [d])
      .join('text')
      .attr('x', d => d.x0 < size[0] / 2 ? nodeWidth + labelPadding : -labelPadding)
      .attr('y', d => - ((d.y0 - d.y1) / 2))
      .attr('dominant-baseline', 'middle')
      .attr('text-anchor', d => d.x0 < size[0] / 2 ? 'start' : 'end')
      .text(d => d.name)

  }

  // Getters and setters
  my.size = function (value) {
    if (!arguments.length) return size
    size = value
    return my
  }

  my.nodeWidth = function (value) {
    if (!arguments.length) return nodeWidth
    nodeWidth = value
    return my
  }

  my.nodePadding = function (value) {
    if (!arguments.length) return nodePadding
    nodePadding = value
    return my
  }

  my.labelPadding = function (value) {
    if (!arguments.length) return labelPadding
    labelPadding = value
    return my
  }

  my.fontFamily = function (value) {
    if (!arguments.length) return fontFamily
    fontFamily = value
    return my
  }

  my.fontSize = function (value) {
    if (!arguments.length) return fontSize
    fontSize = value
    return my
  }

  my.colorScale = function (value) {
    if (!arguments.length) return colorScale
    colorScale = value
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
        <ControlSection title="Color" :col-span="2">
          <ControlToggleGroup :model-value="controls.color" :options="COLOR_OPTIONS"
            @update:model-value="updateControl('color', $event)"></ControlToggleGroup>
        </ControlSection>
      </div>
    </Teleport>
    <div ref="containerRef" class="chart-elev w-full"
      style="aspect-ratio: 4/3; position: relative;">
      <svg>
        <g></g>
      </svg>
    </div>
  </div>
</template>

<style scoped>
:deep(g.link) {
  stroke-opacity: .7;
}

:deep(g.node),
:deep(g.link) {
  cursor: pointer;
}

:deep(g.node) {
  stroke-opacity: 0;
  stroke-width: 0;
}

:deep(g.node:hover) {
  stroke-opacity: 1;
  stroke-width: 1.5;
  font-weight: bold;
}

:deep(svg > g *) {
  transition: all 1500ms,
    stroke-opacity 150ms,
    font-weight 150ms;
}
</style>