<script setup>
import { ref, computed, watch, toRef } from 'vue'
import { storeToRefs } from 'pinia'
import * as d3 from 'd3'
import { ArrowLeft, ChevronRight } from 'lucide-vue-next'
import NodeSearchInput from '@/components/NodeSearchInput.vue'
import { useEgoSubgraph } from '@/composables/useEgoSubgraph.js'
import { useGraphNodes } from '@/composables/useGraphNodes.js'
import { useNodeTypeColors } from '@/composables/useNodeTypeColors.js'
import { usePanelContextFromProps } from '@/composables/usePanelContext.js'
import { useSelectionStore } from '@/stores/selection.js'
import { useForceGraph } from '@/composables/useForceGraph.js'
import { usePanel } from './usePanel.js'
import { fromEgoPayload } from './layeredGraph.js'
import { makeTooltip, showTip, hideTip } from './shared.js'
import ControlSection from './controls/ControlSection.vue'
import ControlSwitch from './controls/ControlSwitch.vue'
import ControlToggleGroup from './controls/ControlToggleGroup.vue'
import SliderControl from './controls/SliderControl.vue'

const props = defineProps({
  panelSpec: { type: Object, required: true },
  schema: { type: Object, default: null },
  graphId: { type: String, default: null },
  widened: { type: Boolean, default: false },
  controlsTarget: { type: String, default: null },
})

defineEmits(['request-widen', 'request-shrink'])

const selection = useSelectionStore()
const { ids: selectedRef } = storeToRefs(selection)
const { controls, updateControl } = usePanel(props, 'ego')
const { color: typeColor } = useNodeTypeColors(toRef(props, 'schema'))
const { data: allNodes } = useGraphNodes(toRef(props, 'graphId'))
// Alters attenuate under the global filter; ego is immune (it's the focus).
const { activeNodeMask, activeEdgeMask, isActive: isActiveId, isEdgeActive } = usePanelContextFromProps(props)

// Local nav stack (top = active); seeded by selection.ids[0], doesn't write back.
const egoStack = ref([])
const activeEgoId = computed(() => egoStack.value[egoStack.value.length - 1] ?? null)

watch(
  () => selectedRef.value[0] ?? null,
  (head) => {
    if (!head) { egoStack.value = []; return }
    if (egoStack.value[0] !== head) egoStack.value = [head]
  },
  { immediate: true },
)

function pushEgo(id) {
  const sid = String(id)
  if (egoStack.value[egoStack.value.length - 1] === sid) return
  egoStack.value.push(sid)
}
function jumpTo(idx) { egoStack.value = egoStack.value.slice(0, idx + 1) }
function goBack() { if (egoStack.value.length > 1) egoStack.value.pop() }
function pickSuggestion(id) { egoStack.value = [String(id)] }

const egoIdRef = computed(() => activeEgoId.value)
const kRef = computed(() => controls.value.k)
const capRef = computed(() => controls.value.cap)
const directionRef = computed(() => controls.value.direction)
const { data, loading, error } = useEgoSubgraph(
  egoIdRef, kRef, capRef, toRef(props, 'graphId'), directionRef,
)

const K_OPTIONS = computed(() => {
  const big = (props.schema?.nodes ?? 0) > 5000
  return [
    { k: 1, label: '1' },
    { k: 2, label: '2' },
    { k: 3, label: '3', disabled: big, title: big ? 'k=3 often exceeds the hard cap on this graph' : '' },
  ]
})
const HIGHLIGHT_OPTIONS = [
  { k: 'type', label: 'Type' },
  { k: 'degree', label: 'Degree' },
]
const DIRECTION_OPTIONS = [
  { k: 'out', label: 'Out' },
  { k: 'in', label: 'In' },
  { k: 'both', label: 'Both' },
]
const isDirected = computed(() => !!props.schema?.directed)

// Auto-hide edge labels above 50 edges (DOM cost + clutter).
const edgeLabelsVisible = computed(() =>
  controls.value.showEdgeLabels && (data.value?.edges?.length ?? 0) <= 50,
)

const egoNode = computed(() => data.value?.nodes?.find(n => n.id === activeEgoId.value) ?? null)
const captionLines = computed(() => {
  const lines = []
  if (egoNode.value) {
    lines.push(`Ego: ${egoNode.value.id} · ${egoNode.value.type} · deg ${egoNode.value.degree}`)
  }
  if (data.value?.sampling === 'stratified') {
    lines.push(`Showing ${data.value.cap_effective} of ${data.value.total_before_cap} alters, stratified by type`)
  }
  return lines
})

const layeredGraph = computed(() => fromEgoPayload(data.value))

// Domain shifts per ego subgraph, so this rebuilds reactively.
const degExtent = computed(() => d3.extent(layeredGraph.value.nodes, n => n.degree))
const degScale = computed(() =>
  d3.scaleSequential()
    .domain(degExtent.value[0] != null ? degExtent.value : [0, 1])
    .interpolator(d3.interpolateBlues),
)

const chartContainer = ref(null)
let tooltip = null

function nodeRadius(n) {
  return n.id === activeEgoId.value ? 6 : 3
}

function tooltipHtml(d) {
  const dist = d.distance instanceof Map ? d.distance.get(0) : d.distance
  return `<b>${d.id}</b><br/>${d.type}<br/>degree ${d.degree}<br/>distance ${dist}`
}

function renderNode(g, d) {
  g.selectAll('*').remove()
  const r = nodeRadius(d)
  const isEgo = d.isEgoOf?.has(0) || d.id === activeEgoId.value
  const fill = isEgo
    ? typeColor(d.type)
    : (controls.value.highlight === 'degree' ? degScale.value(d.degree) : typeColor(d.type))
  // Ego stays at full opacity even when filtered out.
  const opacity = isEgo ? 1 : (isActiveId(d.id) ? 1 : 0.2)
  g.append('circle')
    .attr('r', r)
    .attr('fill', fill)
    .attr('fill-opacity', opacity)
    .attr('stroke', isEgo ? '#000' : 'none')
    .attr('stroke-width', isEgo ? 1.5 : 0)
  if (!tooltip) return
  g.on('mouseover', (e) => showTip(tooltip, e, tooltipHtml(d)))
    .on('mousemove', (e) => showTip(tooltip, e, null))
    .on('mouseout', () => hideTip(tooltip))
}

function renderEdge(sel) {
  sel
    .attr('stroke', '#94a3b8')
    .attr('stroke-width', 1)
    .attr('stroke-opacity', d => isEdgeActive(d.edge_id) ? 0.7 : 0.1)
    .attr('marker-end', isDirected.value ? 'url(#ego-arrow)' : null)
}

function onNodeClick(d) {
  if (d.id === activeEgoId.value) return
  pushEgo(d.id)
}

// Arrowhead marker: re-registered on every rebuild (composable wipes the SVG).
function onSvgBuild({ svg }) {
  if (!isDirected.value) return
  svg.append('defs').append('marker')
    .attr('id', 'ego-arrow')
    .attr('viewBox', '0 -5 10 10')
    .attr('refX', 14).attr('refY', 0)  // refX > node radius so the arrowhead stops before the disc
    .attr('markerWidth', 6).attr('markerHeight', 6)
    .attr('orient', 'auto')
    .append('path')
    .attr('d', 'M0,-4L8,0L0,4')
    .attr('fill', '#94a3b8')
}

// Edge labels in a parallel <g>, repositioned each tick; auto-hidden above 50 edges.
function renderOverlay({ svg, simLinks }) {
  let labelsG = svg.select('g.edge-labels')
  if (labelsG.empty()) labelsG = svg.append('g').attr('class', 'edge-labels')
  const visible = edgeLabelsVisible.value
  const dataset = visible ? simLinks : []
  const labelSel = labelsG.selectAll('text').data(dataset, d => `${d.source.id ?? d.source}|${d.target.id ?? d.target}|${d.type}`)
  labelSel.exit().remove()
  labelSel.enter().append('text')
    .merge(labelSel)
    .attr('font-size', 9)
    .attr('fill', '#64748b')
    .attr('text-anchor', 'middle')
    .attr('pointer-events', 'none')
    .text(d => d.type)
}

function overlayTick() {
  if (!edgeLabelsVisible.value) return
  // Position at link midpoint; source/target are resolved to objects post-forceLink.
  const sel = d3.select(chartContainer.value).select('g.edge-labels').selectAll('text')
  sel
    .attr('x', d => (d.source.x + d.target.x) / 2)
    .attr('y', d => (d.source.y + d.target.y) / 2)
}

const { reconcile } = useForceGraph({
  containerRef: chartContainer,
  graphRef: layeredGraph,
  linkDistance: () => controls.value.linkDistance,
  chargeStrength: () => controls.value.chargeStrength,
  renderNode,
  renderEdge,
  getRadius: nodeRadius,
  onNodeClick,
  onSvgBuild,
  renderOverlay,
  overlayTick,
})

// Reconcile on mask flip — opacity attenuation reads activeNodeMask via isActiveId.
watch([activeNodeMask, activeEdgeMask], () => reconcile())

watch(chartContainer, (el) => {
  if (el && !tooltip) tooltip = makeTooltip(el)
})
</script>

<template>
  <div class="flex flex-col gap-1.5 h-full">
    <Teleport v-if="controlsTarget" :to="`#${controlsTarget}`">
      <div class="grid grid-cols-2 auto-rows-min gap-1.5">
        <ControlSection title="Ego" :col-span="2">
          <NodeSearchInput :nodes="allNodes || []" @pick="pickSuggestion" />
        </ControlSection>

        <ControlSection title="k-hop">
          <ControlToggleGroup
            :model-value="controls.k"
            :options="K_OPTIONS"
            @update:model-value="updateControl('k', $event)"
          />
        </ControlSection>

        <ControlSection v-if="isDirected" title="Direction">
          <ControlToggleGroup
            :model-value="controls.direction"
            :options="DIRECTION_OPTIONS"
            @update:model-value="updateControl('direction', $event)"
          />
        </ControlSection>

        <SliderControl
          title="Max nodes"
          :model-value="controls.cap"
          :min="50" :max="1000" :step="50"
          :lazy="true"
          @update:model-value="updateControl('cap', $event)"
        />

        <ControlSection title="View" :col-span="2">
          <div class="flex flex-col gap-1">
            <ControlSwitch
              label="Show edge labels"
              :model-value="controls.showEdgeLabels"
              @update:model-value="updateControl('showEdgeLabels', $event)"
            />
            <ControlToggleGroup
              :model-value="controls.highlight"
              :options="HIGHLIGHT_OPTIONS"
              @update:model-value="updateControl('highlight', $event)"
            />
          </div>
        </ControlSection>

        <SliderControl
          title="Link distance"
          :model-value="controls.linkDistance"
          :min="10" :max="150" :step="5"
          @update:model-value="updateControl('linkDistance', $event)"
        />

        <SliderControl
          title="Charge strength"
          :model-value="controls.chargeStrength"
          :min="-500" :max="-20" :step="10"
          @update:model-value="updateControl('chargeStrength', $event)"
        />
      </div>
    </Teleport>

    <div v-if="egoStack.length > 1" class="flex items-center gap-1 px-1 flex-wrap">
      <button
        class="segmented-pill inline-flex h-5 items-center gap-0.5 px-1.5 text-[10px]"
        title="Back"
        @click="goBack"
      ><ArrowLeft :size="10" /> Back</button>
      <template v-for="(id, i) in egoStack" :key="`${id}-${i}`">
        <ChevronRight v-if="i > 0" :size="10" class="text-muted shrink-0" />
        <button
          class="type-chip text-[10px] px-2 py-0.5"
          :class="{ 'type-chip--active': i === egoStack.length - 1 }"
          @click="jumpTo(i)"
        >{{ id.length > 12 ? id.slice(0, 12) + '…' : id }}</button>
      </template>
    </div>

    <div
      v-if="!egoStack.length"
      class="flex flex-1 flex-col items-center justify-center gap-2 surface-recessed rounded-lg p-4 text-sm text-secondary"
    >
      <p class="text-center">Select a node from another panel or search below.</p>
      <div class="w-64">
        <NodeSearchInput :nodes="allNodes || []" @pick="pickSuggestion" />
      </div>
    </div>

    <template v-else>
      <div
        v-if="loading"
        class="text-sm text-secondary p-3 surface-recessed rounded-lg"
      >Loading ego subgraph…</div>
      <div
        v-if="error"
        class="flex flex-col items-center justify-center gap-1 surface-recessed rounded-lg p-3 border border-red-200 text-sm text-red-600"
      >
        <p class="text-center">{{ error }}</p>
        <p class="text-[11px] text-muted">Reduce k-hop or pick a less central node.</p>
      </div>
      <div
        ref="chartContainer"
        class="chart-elev w-full relative"
        :class="{ 'hidden': loading || error }"
        style="aspect-ratio: 4/3;"
      ></div>
      <div v-if="captionLines.length && !loading && !error" class="px-1 text-[10px] text-muted leading-tight">
        <p v-for="(l, i) in captionLines" :key="i">{{ l }}</p>
      </div>
      <p v-if="!loading && !error" class="text-[10px] leading-tight text-muted px-1">
        Ego subgraph fetched on the full graph; current filter attenuates alters whose type or degree falls outside it.
      </p>
    </template>
  </div>
</template>
