<script setup>
import { computed } from 'vue'
import { Maximize2, Minimize2, Trash2, BookOpen, SlidersHorizontal, Lock, Unlock } from 'lucide-vue-next'
import { useSelectionStore } from '../stores/selection.js'
import { useIsolationStore } from '../stores/isolation.js'
import { useFiltersStore } from '../stores/filters.js'
import { usePanelContextFromProps } from '../composables/usePanelContext.js'

const props = defineProps({
  panelSpec:    { type: Object, required: true },
  schema:       { type: Object, default: null },
  graphId:      { type: String, default: null },
  expanded:     { type: Boolean, default: false },
  widened:      { type: Boolean, default: false },
  controlsOpen: { type: Boolean, default: false },
  drawerId:     { type: String, default: null },
  drawerReady:  { type: Boolean, default: false },
})

defineEmits(['remove', 'focus', 'toggle-expand', 'toggle-controls', 'request-widen', 'request-shrink'])

const selection = useSelectionStore()
const isolation = useIsolationStore()
const filters = useFiltersStore()
const { activeNodeMask, activeEdgeMask } = usePanelContextFromProps(props)

const isIsolated = computed(() => isolation.isFrozen(props.panelSpec.id))

// Lock = full freeze. Deep-clone every live signal the panel currently reads
// so post-Lock mutations to filters/selection/masks don't leak through.
// Filters use $state cloned via JSON; Bitsets via .clone(); selection.ids
// copied as a plain array.
function toggleLock() {
  const panelId = props.panelSpec.id
  if (isolation.isFrozen(panelId)) {
    isolation.unfreeze(panelId)
    return
  }
  const nMask = activeNodeMask.value
  if (!nMask) return
  const eMask = activeEdgeMask.value
  const snapshot = {
    filters: JSON.parse(JSON.stringify(filters.$state)),
    selection: [...selection.ids],
    activeNodeMask: nMask.clone(),
    activeEdgeMask: eMask ? eMask.clone() : null,
  }
  isolation.freeze(panelId, snapshot)
}
</script>

<template>
  <div
    class="card-elev group flex flex-col rounded-md relative"
    :class="[
      expanded ? 'col-span-2 row-span-2' : (widened ? 'col-span-2' : ''),
      isIsolated ? 'ring-2 ring-amber-400' : '',
    ]"
  >
    <div
      v-if="isIsolated"
      class="pointer-events-none absolute -top-2 -left-2 rounded-full bg-amber-400 p-1 shadow-sm"
      title="Panel is locked"
    >
      <Lock :size="10" class="text-white" />
    </div>
    <div class="flex items-center justify-between p-1">
      <p class="pl-3 text-base font-bold leading-6 text-primary">{{ panelSpec.label }}</p>
      <div class="segmented-track inline-flex items-center">
        <button
          class="segmented-pill inline-flex h-6 w-6 shrink-0 items-center justify-center"
          :class="{ 'segmented-pill--active': controlsOpen }"
          title="Controls"
          @click="$emit('toggle-controls')">
          <SlidersHorizontal :size="14" />
        </button>
        <button
          class="segmented-pill inline-flex h-6 w-6 shrink-0 items-center justify-center"
          :class="{ 'segmented-pill--active': isIsolated }"
          :title="isIsolated ? 'Unlock (resume live updates)' : 'Lock (freeze current state)'"
          @click="toggleLock">
          <component :is="isIsolated ? Unlock : Lock" :size="14" />
        </button>
        <button
          class="segmented-pill inline-flex h-6 w-6 shrink-0 items-center justify-center"
          :class="{ 'segmented-pill--active': expanded || widened }"
          :title="(expanded || widened) ? 'Shrink' : 'Enlarge'"
          @click="$emit('toggle-expand')">
          <component :is="(expanded || widened) ? Minimize2 : Maximize2" :size="14" />
        </button>
        <button
          class="segmented-pill inline-flex h-6 w-6 shrink-0 items-center justify-center"
          title="Open detail"
          @click="$emit('focus')">
          <BookOpen :size="14" />
        </button>
        <button
          class="segmented-pill segmented-pill--danger inline-flex h-6 w-6 shrink-0 items-center justify-center"
          title="Remove"
          @click="$emit('remove')">
          <Trash2 :size="14" />
        </button>
      </div>
    </div>

    <!-- Collapsible settings strip, embedded inside the card just above the chart.
         Renders only when controls open; Teleport target lives inside so the panel
         component can inject its controls here without leaving the card. -->
    <div v-if="controlsOpen" class="mx-4 mb-3 mt-2">
      <div :id="drawerId" />
    </div>

    <div class="min-h-0 flex-1 p-1">
      <component
        :is="panelSpec.component"
        v-bind="panelSpec.componentProps || {}"
        :panel-spec="panelSpec"
        :schema="schema"
        :graph-id="graphId"
        :widened="widened"
        :controls-target="drawerReady ? drawerId : null"
        @request-widen="$emit('request-widen')"
        @request-shrink="$emit('request-shrink')"
      />
    </div>
  </div>
</template>
