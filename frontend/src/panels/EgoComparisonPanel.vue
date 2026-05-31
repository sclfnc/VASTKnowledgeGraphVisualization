<script setup>
import { ref, computed, toRef, watch } from 'vue'
import { storeToRefs } from 'pinia'
import * as d3 from 'd3'
import { X, Plus } from 'lucide-vue-next'
import NodeSearchInput from '@/components/NodeSearchInput.vue'
import { injectGraphNodes } from '@/composables/useGraphNodes.js'
import { useEgoSubgraph } from '@/composables/useEgoSubgraph.js'
import { useEffectiveType } from '@/composables/useEffectiveType.js'
import { usePanelContextFromProps } from '@/composables/usePanelContext.js'
import { useSelectionStore, MAX_LAYERS } from '@/stores/selection.js'
import { useForceGraph } from '@/composables/useForceGraph.js'
import { usePanel } from './usePanel.js'
import { fromEgoPayload, mergeLayers, filterIntersection } from './layeredGraph.js'
import { makeTooltip, showTip, hideTip, LAYER_PALETTE } from './shared.js'
import ControlSection from './controls/ControlSection.vue'
import ControlSwitch from './controls/ControlSwitch.vue'
import ControlToggleGroup from './controls/ControlToggleGroup.vue'
import SliderControl from './controls/SliderControl.vue'

const props = defineProps({
  panelSpec: { type: Object, required: true },
  schema: { type: Object, default: null },
  graphId: { type: String, default: null },
  widened: { type: Boolean, default: false },
  expanded: { type: Boolean, default: false },
  controlsTarget: { type: String, default: null },
})

defineEmits(['request-widen', 'request-shrink'])

const { controls, updateControl } = usePanel(props, 'ego_compare')
const { data: allNodes } = injectGraphNodes(toRef(props, 'graphId'))
const { nodeType: effNodeType } = useEffectiveType(toRef(props, 'graphId'), toRef(props, 'schema'))
const { activeNodeMask, activeEdgeMask, isActive: isActiveId, isEdgeActive } = usePanelContextFromProps(props)

// Selection store is unbounded; crop to MAX_LAYERS — pie encoding breaks above 4.
const selection = useSelectionStore()
const { ids: selectionIds } = storeToRefs(selection)
const egos = computed(() => selectionIds.value.slice(0, MAX_LAYERS))
const canAddMore = computed(() => egos.value.length < MAX_LAYERS)

function addEgo(id) {
  const sid = String(id)
  if (selectionIds.value.includes(sid)) return
  selection.add(sid)
}
function removeEgo(idx) {
  const sid = egos.value[idx]
  if (sid) selection.remove(sid)
}

const isDirected = computed(() => !!props.schema?.directed)
const DIRECTION_OPTIONS = [
  { k: 'out', label: 'Out' },
  { k: 'in', label: 'In' },
  { k: 'both', label: 'Both' },
]

// Four fixed slots — composables can't be conditionally instantiated. Empty slot → null data.
const k = computed(() => controls.value.k)
const cap = computed(() => controls.value.cap)
const direction = computed(() => controls.value.direction)
const slot0 = computed(() => egos.value[0] ?? null)
const slot1 = computed(() => egos.value[1] ?? null)
const slot2 = computed(() => egos.value[2] ?? null)
const slot3 = computed(() => egos.value[3] ?? null)
const e0 = useEgoSubgraph(slot0, k, cap, toRef(props, 'graphId'), direction)
const e1 = useEgoSubgraph(slot1, k, cap, toRef(props, 'graphId'), direction)
const e2 = useEgoSubgraph(slot2, k, cap, toRef(props, 'graphId'), direction)
const e3 = useEgoSubgraph(slot3, k, cap, toRef(props, 'graphId'), direction)
const slots = [e0, e1, e2, e3]
const anyLoading = computed(() => slots.some(s => s.loading.value))
const anyError = computed(() => slots.find(s => s.error.value)?.error.value || null)

// fromEgoPayload tags nodes/edges with layer i; mergeLayers unions; intersection is a filter on top.
const merged = computed(() =>
  mergeLayers(egos.value.map((_, i) => fromEgoPayload(slots[i].data.value, i)))
)
const filtered = computed(() => {
  if (controls.value.showNonCommon || egos.value.length < 2) return merged.value
  return filterIntersection(merged.value, 2)
})

const caption = computed(() => {
  const u = merged.value
  if (egos.value.length < 2) return null
  const intersection = u.nodes.filter(n => n.layers.size === egos.value.length).length
  const anyPair = u.nodes.filter(n => n.layers.size >= 2).length
  return `${intersection} node${intersection === 1 ? '' : 's'} in all ${egos.value.length} ego networks · ${anyPair} appear in ≥2`
})

const chartContainer = ref(null)
let tooltip = null

function nodeRadius(n) {
  return n.isEgoOf?.size > 0 ? 7 : 4
}

function tooltipHtml(d) {
  const layerList = [...d.layers].sort((a, b) => a - b)
    .map(li => `<span style="display:inline-block;width:8px;height:8px;background:${LAYER_PALETTE[li]};border-radius:50%;margin-right:2px"></span>${egos.value[li]}`)
    .join('<br/>')
  return `<b>${d.id}</b><br/>${effNodeType(d)}<br/>degree ${d.degree}<br/>in ${d.layers.size} ego${d.layers.size === 1 ? '' : 's'}:<br/>${layerList}`
}

function renderNode(g, d) {
  g.selectAll('*').remove()
  const r = nodeRadius(d)
  const layers = [...d.layers].sort((a, b) => a - b)
  // Egos stay at full opacity; non-egos attenuate under the global filter.
  const opacity = d.isEgoOf?.size > 0 ? 1 : (isActiveId(d.id) ? 1 : 0.2)
  if (layers.length === 1) {
    g.append('circle').attr('r', r).attr('fill', LAYER_PALETTE[layers[0]]).attr('fill-opacity', opacity)
  } else {
    const arc = d3.arc().innerRadius(0).outerRadius(r)
    const step = (Math.PI * 2) / layers.length
    layers.forEach((li, i) => {
      g.append('path')
        .attr('d', arc({ startAngle: i * step, endAngle: (i + 1) * step }))
        .attr('fill', LAYER_PALETTE[li])
        .attr('fill-opacity', opacity)
    })
  }
  if (d.isEgoOf?.size > 0) {
    g.append('circle').attr('r', r + 1).attr('fill', 'none')
      .attr('stroke', '#000').attr('stroke-width', 1.5)
  }
  if (!tooltip) return
  g.on('mouseover', (e) => showTip(tooltip, e, tooltipHtml(d)))
    .on('mousemove', (e) => showTip(tooltip, e, null))
    .on('mouseout', () => hideTip(tooltip))
}

function renderEdge(sel) {
  sel
    .attr('stroke', d => LAYER_PALETTE[Math.min(...d.layers)])
    .attr('stroke-opacity', d => {
      if (!isEdgeActive(d.edge_id)) return 0.1
      return d.layers.size >= 2 ? 0.85 : 0.45
    })
    .attr('stroke-width', d => d.layers.size >= 2 ? 1.6 : 1)
}

function onNodeClick(d) {
  // Promote non-ego to a new layer (no-op if full).
  if (d.isEgoOf?.size > 0) return
  addEgo(d.id)
}

const { reconcile } = useForceGraph({
  containerRef: chartContainer,
  graphRef: filtered,
  linkDistance: () => controls.value.linkDistance,
  chargeStrength: () => controls.value.chargeStrength,
  renderNode,
  renderEdge,
  getRadius: nodeRadius,
  onNodeClick,
  spanFlags: () => [props.widened, props.expanded],
})

watch([activeNodeMask, activeEdgeMask], () => reconcile())

watch(chartContainer, (el) => {
  if (el && !tooltip) tooltip = makeTooltip(el)
})
</script>

<template>
  <div class="flex flex-col gap-1.5 h-full">
    <Teleport v-if="controlsTarget" :to="`#${controlsTarget}`">
      <div class="grid grid-cols-2 auto-rows-min gap-1.5">
        <ControlSection title="Add ego" :col-span="2">
          <NodeSearchInput
            :nodes="allNodes || []"
            :exclude="egos"
            :disabled="!canAddMore"
            :placeholder="canAddMore ? 'Search node by id…' : `Max ${MAX_LAYERS} egos`"
            @pick="addEgo"
          />
        </ControlSection>

        <ControlSection title="View" :col-span="2">
          <ControlSwitch
            label="Show non-common nodes"
            :model-value="controls.showNonCommon"
            @update:model-value="updateControl('showNonCommon', $event)"
          />
        </ControlSection>

        <ControlSection title="k-hop">
          <div class="flex gap-1">
            <button
              v-for="kVal in [1, 2, 3]" :key="kVal"
              class="segmented-pill flex-1 px-2 py-0.5 text-[10px]"
              :class="{ 'segmented-pill--active': controls.k === kVal }"
              @click="updateControl('k', kVal)"
            >{{ kVal }}</button>
          </div>
        </ControlSection>

        <ControlSection v-if="isDirected" title="Direction">
          <ControlToggleGroup
            :model-value="controls.direction"
            :options="DIRECTION_OPTIONS"
            @update:model-value="updateControl('direction', $event)"
          />
        </ControlSection>

        <SliderControl
          title="Max nodes / ego"
          :model-value="controls.cap"
          :min="50" :max="1000" :step="50"
          :lazy="true"
          @update:model-value="updateControl('cap', $event)"
        />

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

    <div v-if="egos.length" class="flex items-center gap-1 px-1 flex-wrap">
      <span class="text-[10px] text-muted uppercase tracking-wider mr-1">Egos</span>
      <span
        v-for="(id, i) in egos" :key="`${id}-${i}`"
        class="type-chip text-[10px] px-2 py-0.5 inline-flex items-center gap-1"
        :style="{ borderColor: LAYER_PALETTE[i], color: LAYER_PALETTE[i] }"
      >
        <span class="inline-block w-2 h-2 rounded-full" :style="{ background: LAYER_PALETTE[i] }"></span>
        <span>{{ id.length > 14 ? id.slice(0, 14) + '…' : id }}</span>
        <button class="hover:text-red-500" @click="removeEgo(i)"><X :size="10" /></button>
      </span>
      <span v-if="canAddMore" class="text-[10px] text-muted inline-flex items-center gap-0.5">
        <Plus :size="10" /> add up to {{ MAX_LAYERS - egos.length }} more in the drawer
      </span>
    </div>

    <div
      v-if="!egos.length"
      class="flex flex-1 flex-col items-center justify-center gap-2 surface-recessed rounded-lg p-4 text-sm text-secondary"
    >
      <p class="text-center">Add 2–4 nodes from the drawer to compare their ego networks.</p>
    </div>

    <template v-else>
      <div
        v-if="anyError"
        class="surface-recessed rounded-lg p-3 border border-red-200 text-sm text-red-600"
      >
        <p>{{ anyError }}</p>
        <p class="text-[11px] text-muted">Reduce k-hop or remove the offending ego.</p>
      </div>
      <div
        v-else-if="anyLoading && !filtered.nodes.length"
        class="text-sm text-secondary p-3 surface-recessed rounded-lg"
      >Loading ego subgraphs…</div>

      <div
        ref="chartContainer"
        class="chart-elev w-full relative"
        :class="{ 'hidden': anyError || (anyLoading && !filtered.nodes.length) }"
        style="aspect-ratio: 4/3;"
      ></div>
      <div v-if="caption && !anyError" class="px-1 text-[10px] text-muted leading-tight">
        {{ caption }}
      </div>
      <p v-if="egos.length" class="text-[10px] leading-tight text-muted px-1">
        Ego subgraphs fetched on the full graph; current filter attenuates non-ego nodes outside it.
      </p>
    </template>
  </div>
</template>
