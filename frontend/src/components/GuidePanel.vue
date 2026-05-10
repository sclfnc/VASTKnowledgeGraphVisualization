<script setup>
// EXTENSION: flat card panel with focus modal, theory drawer, and resize buttons
import { ref } from 'vue'
import { Maximize2, Minimize2, Trash2 } from 'lucide-vue-next'

defineProps({
  panelSpec:  { type: Object, required: true },
  schema:     { type: Object, required: true },
  graphId:    { type: String, required: true },
})

defineEmits(['remove', 'focus'])

const expanded = ref(false)
</script>

<template>
  <div
    class="group flex flex-col rounded-xl border border-slate-200/80 bg-white shadow-[0_1px_2px_rgba(15,23,42,0.04),0_8px_24px_-8px_rgba(15,23,42,0.12)] transition-all duration-200 hover:-translate-y-0.5 hover:shadow-[0_2px_4px_rgba(15,23,42,0.06),0_16px_40px_-12px_rgba(15,23,42,0.18)] hover:border-slate-300"
    :class="expanded ? 'col-span-2 row-span-2' : ''"
  >
    <!-- header — click opens focus modal -->
    <div class="flex cursor-pointer items-center justify-between px-4 py-3 group-hover:bg-slate-50" @click="$emit('focus')">
      <div class="flex items-center gap-2">
        <div>
          <p class="text-sm font-medium text-slate-800">{{ panelSpec.label }}</p>
        </div>
      </div>
      <div class="flex items-center gap-1.5" @click.stop>
        <button class="text-slate-400 hover:text-slate-700" :title="expanded ? 'Shrink' : 'Enlarge'" @click="expanded = !expanded">
          <component :is="expanded ? Minimize2 : Maximize2" :size="14" />
        </button>
        <button class="ml-1 text-slate-300 hover:text-red-400" title="Remove" @click="$emit('remove')">
          <Trash2 :size="14" />
        </button>
      </div>
    </div>
    <div class="border-t border-slate-100 px-3 py-2">
      <component
        :is="panelSpec.component"
        :panelSpec="panelSpec"
        :schema="schema"
        :graphId="graphId"
        :showExplanation="false"
      />
    </div>
  </div>
</template>
