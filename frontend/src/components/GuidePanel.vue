<script setup>
// EXTENSION: flat card panel with focus modal, theory drawer, and resize buttons
import { Maximize2, Minimize2, Trash2, SlidersHorizontal, BookOpen } from 'lucide-vue-next'

defineProps({
  panelSpec:    { type: Object, required: true },
  schema:       { type: Object, required: true },
  graphId:      { type: String, required: true },
  expanded:     { type: Boolean, default: false },
  widened:      { type: Boolean, default: false },
  controlsOpen: { type: Boolean, default: false },
  drawerId:     { type: String, default: null },
  drawerReady:  { type: Boolean, default: false },
})

defineEmits(['remove', 'focus', 'toggle-expand', 'toggle-controls'])
</script>

<template>
  <div
    class="group flex flex-col rounded-xl bg-white"
    :class="expanded ? 'col-span-2 row-span-2' : (widened ? 'col-span-2' : '')"
  >
    <!-- header -->
    <div class="flex items-center justify-between px-4 pt-3 pb-1">
      <p class="text-sm font-bold leading-6 text-slate-800">{{ panelSpec.label }}</p>
      <div class="flex items-center gap-1.5">
        <button
          class="inline-flex h-6 w-6 shrink-0 items-center justify-center rounded-full border p-0 leading-none transition-colors"
          :class="controlsOpen
            ? 'border-sky-500 bg-sky-100 text-sky-700'
            : 'border-sky-200 bg-white text-sky-600 hover:border-sky-500 hover:bg-sky-50'"
          title="Controls"
          @click="$emit('toggle-controls')">
          <SlidersHorizontal :size="14" />
        </button>
        <button
          class="inline-flex h-6 w-6 shrink-0 items-center justify-center rounded-full border border-violet-200 bg-white p-0 leading-none text-violet-600 transition-colors hover:border-violet-500 hover:bg-violet-50"
          :title="(expanded || widened) ? 'Shrink' : 'Enlarge'"
          @click="$emit('toggle-expand')">
          <component :is="(expanded || widened) ? Minimize2 : Maximize2" :size="14" />
        </button>
        <button
          class="inline-flex h-6 w-6 shrink-0 items-center justify-center rounded-full border border-emerald-200 bg-white p-0 leading-none text-emerald-600 transition-colors hover:border-emerald-500 hover:bg-emerald-50"
          title="Open detail"
          @click="$emit('focus')">
          <BookOpen :size="14" />
        </button>
        <button
          class="inline-flex h-6 w-6 shrink-0 items-center justify-center rounded-full border border-red-200 bg-white p-0 leading-none text-red-500 transition-colors hover:border-red-500 hover:bg-red-50"
          title="Remove"
          @click="$emit('remove')">
          <Trash2 :size="14" />
        </button>
      </div>
    </div>

    <!-- body: chart fills the card (which is col-span-2 when controls open) -->
    <div class="min-h-0 flex-1 px-1 pt-4 pb-2">
      <component
        :is="panelSpec.component"
        :panelSpec="panelSpec"
        :schema="schema"
        :graphId="graphId"
        :showExplanation="false"
        :controlsTarget="drawerReady ? drawerId : null"
      />
    </div>
  </div>
</template>

<style scoped>
.drawer-enter-active, .drawer-leave-active { transition: opacity 0.15s ease; }
.drawer-enter-from, .drawer-leave-to { opacity: 0; }
</style>
