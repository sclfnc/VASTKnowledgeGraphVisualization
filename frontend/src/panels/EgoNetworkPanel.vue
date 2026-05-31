<script setup>
import { ref, computed, watch, toRef } from 'vue'
import { storeToRefs } from 'pinia'
import * as d3 from 'd3'
import { ArrowLeft, ChevronRight } from 'lucide-vue-next'
import NodeSearchInput from '@/components/NodeSearchInput.vue'
import { useEgoSubgraph } from '@/composables/useEgoSubgraph.js'
import { injectGraphNodes } from '@/composables/useGraphNodes.js'
import { useNodeTypeColors } from '@/composables/useNodeTypeColors.js'
import { useEffectiveType } from '@/composables/useEffectiveType.js'
import { usePanelContextFromProps } from '@/composables/usePanelContext.js'
import { useSelectionStore } from '@/stores/selection.js'
import { useForceGraph } from '@/composables/useForceGraph.js'
import { usePanel } from './usePanel.js'
import { fromEgoPayload } from './layeredGraph.js'
import { makeTooltip, showTip, hideTip } from './shared.js'
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

defineEmits(['request-widen', 'request-shrink'])

// Inline theory-link classes (global Tailwind; the block is teleported out).
const THEORY_LINK = 'underline underline-offset-2 font-medium text-sky-700 hover:text-sky-900 cursor-pointer'
const THEORY_LINK_ON = 'no-underline font-medium text-sky-700 bg-sky-100 rounded px-1 cursor-pointer'
function theoryLinkClass(on) { return on ? THEORY_LINK_ON : THEORY_LINK }

const selection = useSelectionStore()
const { ids: selectedRef } = storeToRefs(selection)
const { controls, updateControl } = usePanel(props, 'ego')
const { color: typeColor } = useNodeTypeColors(toRef(props, 'schema'))
const { nodeType: effNodeType, nodeTypeList } = useEffectiveType(toRef(props, 'graphId'), toRef(props, 'schema'))
const { data: allNodes } = injectGraphNodes(toRef(props, 'graphId'))
// Alters attenuate under the global filter; ego is immune (it's the focus).
const { activeNodeMask, activeEdgeMask, isActive: isActiveId, isEdgeActive } = usePanelContextFromProps(props)

// Local nav stack (top = active). Two-way coupling with the global selection:
//   - On external selection changes (sidebar / other panel / cross-graph
//     teardown) the head of `selection.ids` is mirrored into the stack head;
//     this resets the breadcrumb because external sources don't carry a stack.
//   - On local navigation (push/pop/jump/pick) we broadcast the new head into
//     selection. `isLocalUpdate` short-circuits the watch so the broadcast
//     doesn't bounce back and clobber the stack.
const egoStack = ref([])
const activeEgoId = computed(() => egoStack.value[egoStack.value.length - 1] ?? null)
let isLocalUpdate = false

watch(
  () => selectedRef.value[0] ?? null,
  (head) => {
    if (isLocalUpdate) { isLocalUpdate = false; return }
    if (!head) { egoStack.value = []; return }
    if (activeEgoId.value !== head) egoStack.value = [head]
  },
  { immediate: true },
)

function broadcastHead() {
  const head = activeEgoId.value
  isLocalUpdate = true
  if (head) selection.replace([head])
  else selection.clear()
}

function pushEgo(id) {
  const sid = String(id)
  if (activeEgoId.value === sid) return
  egoStack.value.push(sid)
  broadcastHead()
}
function jumpTo(idx) { egoStack.value = egoStack.value.slice(0, idx + 1); broadcastHead() }
// Undo the last navigation step. From a single-level stack this pops back to
// the empty state (clears the ego), so the user can always step back.
function goBack() { if (egoStack.value.length) { egoStack.value.pop(); broadcastHead() } }
function pickSuggestion(id) { egoStack.value = [String(id)]; broadcastHead() }

const egoIdRef = computed(() => activeEgoId.value)
const kRef = computed(() => controls.value.k)
const capRef = computed(() => controls.value.cap)
const directionRef = computed(() => controls.value.direction)
const { data, loading, error } = useEgoSubgraph(
  egoIdRef, kRef, capRef, toRef(props, 'graphId'), directionRef,
)

const bigGraph = computed(() => (props.schema?.nodes ?? 0) > 5000)
const K_OPTIONS = computed(() => [
  { k: 1, label: '1' },
  { k: 2, label: '2' },
  { k: 3, label: '3', disabled: bigGraph.value, title: bigGraph.value ? 'k=3 often exceeds the hard cap on this graph' : '' },
])
const HIGHLIGHT_OPTIONS = [
  { k: 'type', label: 'Type' },
  { k: 'degree', label: 'Degree' },
]
// Node types the user chose to accentuate (drawer chip multi-select). Empty =
// no accentuation, every type rendered normally.
const highlightSet = computed(() => new Set(controls.value.highlightTypes ?? []))
function toggleHighlightType(t) {
  const cur = controls.value.highlightTypes ?? []
  const next = cur.includes(t) ? cur.filter(x => x !== t) : [...cur, t]
  updateControl('highlightTypes', next)
}
const DIRECTION_OPTIONS = [
  { k: 'out', label: 'Out' },
  { k: 'in', label: 'In' },
  { k: 'both', label: 'Both' },
]
const isDirected = computed(() => !!props.schema?.directed)

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

// Types actually present in the current ego subgraph, for the inline legend.
const presentTypes = computed(() => {
  const set = new Set()
  for (const n of layeredGraph.value.nodes) set.add(effNodeType(n))
  return [...set].sort()
})

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
  return `<b>${d.id}</b><br/>${effNodeType(d)}<br/>degree ${d.degree}<br/>distance ${dist}`
}

function renderNode(g, d) {
  g.selectAll('*').remove()
  const r = nodeRadius(d)
  const isEgo = d.isEgoOf?.has(0) || d.id === activeEgoId.value
  const t = effNodeType(d)
  const fill = isEgo
    ? typeColor(t)
    : (controls.value.highlight === 'degree' ? degScale.value(d.degree) : typeColor(t))
  // Ego stays full opacity. Otherwise: a node is dimmed if it falls outside the
  // global filter, OR if a type-accentuation set is active and its type isn't in it.
  const hl = highlightSet.value
  const dimmedByHighlight = hl.size > 0 && !hl.has(t)
  const opacity = isEgo ? 1 : (isActiveId(d.id) && !dimmedByHighlight ? 1 : 0.2)
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

function onEdgeClick(d) {
  if (d.edge_id === undefined || d.edge_id === null) return
  selection.replaceEdges([d.edge_id])
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

const { reconcile } = useForceGraph({
  containerRef: chartContainer,
  graphRef: layeredGraph,
  linkDistance: () => controls.value.linkDistance,
  chargeStrength: () => controls.value.chargeStrength,
  renderNode,
  renderEdge,
  getRadius: nodeRadius,
  onNodeClick,
  onEdgeClick,
  onSvgBuild,
  spanFlags: () => [props.widened, props.expanded],
})

// Reconcile on mask flip — opacity attenuation reads activeNodeMask via isActiveId.
// Also on highlight-type change and color-mode flip (both read in renderNode).
watch(
  [activeNodeMask, activeEdgeMask, () => controls.value.highlightTypes, () => controls.value.highlight],
  () => reconcile(),
  { deep: true },
)

watch(chartContainer, (el) => {
  if (el && !tooltip) tooltip = makeTooltip(el)
})
</script>

<template>
  <div class="flex flex-col gap-1.5 h-full">
    <Teleport v-if="theoryTarget" :to="`#${theoryTarget}`">
      <div class="flex flex-col gap-4 text-sm leading-relaxed text-secondary">

        <section class="flex flex-col gap-2">
          <h3 class="text-xs font-semibold uppercase tracking-widest text-muted">Reading this plot</h3>
          <p>
            An <strong>ego network</strong> is the local neighborhood around one chosen node — the
            <strong>ego</strong> — plus its <strong>alters</strong> out to k hops. Step the reach with
            <button :class="theoryLinkClass(controls.k === 1)"
              @click="updateControl('k', 1)">1</button>
            (immediate neighborhood),
            <button :class="theoryLinkClass(controls.k === 2)"
              @click="updateControl('k', 2)">2</button>
            (friends-of-friends), or
            <button :class="theoryLinkClass(controls.k === 3)"
              :disabled="bigGraph"
              :title="bigGraph ? 'k=3 often exceeds the hard cap on this graph' : ''"
              @click="!bigGraph && updateControl('k', 3)">3</button>
            (the next shell<template v-if="bigGraph">, disabled — too large here</template>).<template v-if="egoNode">
              The ego is <strong>{{ egoNode.id }}</strong> ({{ egoNode.type }}, degree
              {{ egoNode.degree }}).</template> The ego is ringed in black; alters are colored by node type.
          </p>
          <p>
            Color nodes —
            <button :class="theoryLinkClass(controls.highlight === 'type')"
              @click="updateControl('highlight', 'type')">by Type</button>
            or
            <button :class="theoryLinkClass(controls.highlight === 'degree')"
              @click="updateControl('highlight', 'degree')">by Degree</button>.
            <template v-if="isDirected">
              On this directed graph, <strong>Direction</strong> (out / in / both) picks which edges the
              BFS follows — they describe different processes, so the view keeps them apart.</template>
            When a neighborhood exceeds the node cap, alters are sampled <em>stratified by type</em> so
            rare types survive instead of being washed out.
          </p>
        </section>

        <section class="flex flex-col gap-2">
          <h3 class="text-xs font-semibold uppercase tracking-widest text-muted">Interacting</h3>
          <p>
            Click an alter to <strong>recenter</strong> the view on it (a breadcrumb tracks the path;
            <strong>Back</strong> undoes the last hop). <strong>Drag</strong> a node to pin it and
            untangle a crowded layout; <strong>drag the background</strong> to pan and
            <strong>scroll</strong> to zoom. Use <strong>Accentuate types</strong> in the drawer to keep
            one or more node types at full opacity while the rest dim — a local highlight that doesn't
            touch filters or selection.
          </p>
        </section>

      </div>
    </Teleport>

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

        <ControlSection title="Color nodes by" :col-span="2">
          <ControlToggleGroup
            :model-value="controls.highlight"
            :options="HIGHLIGHT_OPTIONS"
            @update:model-value="updateControl('highlight', $event)"
          />
        </ControlSection>

        <ControlSection title="Accentuate types" :col-span="2" collapsible :default-open="false">
          <template #actions>
            <button
              v-if="(controls.highlightTypes || []).length"
              class="text-[9px] text-muted hover:text-slate-900 uppercase tracking-wider"
              @click="updateControl('highlightTypes', [])"
            >Clear</button>
          </template>
          <div class="flex flex-wrap gap-1">
            <button
              v-for="t in nodeTypeList" :key="t"
              class="type-chip text-[10px] px-2 py-0.5"
              :class="{ 'type-chip--active': (controls.highlightTypes || []).includes(t) }"
              :style="(controls.highlightTypes || []).includes(t) ? { background: typeColor(t), borderColor: typeColor(t), color: '#fff' } : { borderColor: typeColor(t) }"
              @click="toggleHighlightType(t)"
            >{{ t }}</button>
          </div>
          <p class="text-[10px] text-muted mt-1 leading-tight">
            Pick one or more types to keep at full opacity; the rest dim. Empty = all shown.
          </p>
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

    <div v-if="egoStack.length" class="flex items-center gap-1 px-1 flex-wrap">
      <button
        class="segmented-pill inline-flex h-5 items-center gap-0.5 px-1.5 text-[10px]"
        :title="egoStack.length > 1 ? 'Back to previous ego' : 'Clear ego'"
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
      <div
        v-if="presentTypes.length && controls.highlight === 'type' && !loading && !error"
        class="flex flex-wrap items-center gap-x-2 gap-y-0.5 px-1 text-[10px] text-muted"
      >
        <span v-for="t in presentTypes" :key="t" class="inline-flex items-center gap-1">
          <span class="inline-block w-2 h-2 rounded-full" :style="{ background: typeColor(t) }"></span>{{ t }}
        </span>
      </div>
      <div v-if="captionLines.length && !loading && !error" class="px-1 text-[10px] text-muted leading-tight">
        <p v-for="(l, i) in captionLines" :key="i">{{ l }}</p>
      </div>
      <p v-if="!loading && !error" class="text-[10px] leading-tight text-muted px-1">
        Showing {{ controls.cap }} alters max, direction <strong>{{ controls.direction }}</strong>. Open settings (sliders icon) to raise the cap{{ isDirected ? ' or change direction' : '' }}. Drag nodes to untangle the layout. Filter attenuates alters whose type or degree falls outside it.
      </p>
    </template>
  </div>
</template>
