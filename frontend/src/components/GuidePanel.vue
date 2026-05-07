<script setup>
// EXTENSION: flat card panel with focus modal, theory drawer, and resize buttons
import { ref } from 'vue'
import { Maximize2, Minimize2, Trash2, Search } from 'lucide-vue-next'

defineProps({
  title:       { type: String, required: true },
  section:     { type: String, default: '' },
  explanation: { type: String, default: '' },
})

defineEmits(['remove', 'focus'])

const expanded = ref(false)
</script>

<template>
  <div class="group flex flex-col rounded-lg border border-transparent bg-white shadow-sm transition hover:border-slate-300 hover:shadow-md" :class="expanded ? 'col-span-2 row-span-2' : ''">
    <!-- header — click opens focus modal -->
    <div class="flex cursor-pointer items-center justify-between px-4 py-3 group-hover:bg-slate-50" @click="$emit('focus')">
      <div class="flex items-center gap-2">
        <Search :size="12" class="text-slate-300 transition group-hover:text-slate-500" />
        <div>
          <p class="text-sm font-medium text-slate-800">{{ title }}</p>
          <p v-if="section" class="text-xs text-slate-300">{{ section }}</p>
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
    <div class="border-t border-slate-100 p-4">
      <slot />
    </div>
  </div>
</template>
