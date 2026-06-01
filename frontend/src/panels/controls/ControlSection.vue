<script setup>
// Drawer section wrapper: rounded white card with a small uppercase title.
// Use as a layout primitive for the per-panel controls drawer.
//
// `collapsible` makes the header a toggle with a chevron; the body is shown via
// v-show (state preserved). `defaultOpen` sets the initial state (default true).
import { ref } from 'vue'
import { ChevronRight } from 'lucide-vue-next'

const props = defineProps({
  title:       { type: String, required: true },
  colSpan:     { type: [Number, String], default: 1 },
  collapsible: { type: Boolean, default: false },
  defaultOpen: { type: Boolean, default: true },
})

const open = ref(props.defaultOpen)
</script>

<template>
  <div
    class="rounded-md bg-white px-2 py-1.5 flex flex-col gap-1"
    :class="colSpan == 2 ? 'col-span-2' : ''"
  >
    <div class="flex items-center justify-between">
      <button
        v-if="collapsible"
        class="flex items-center gap-1 text-[9px] font-semibold text-muted uppercase tracking-wider hover:text-slate-900"
        @click="open = !open"
      >
        <ChevronRight :size="10" class="transition-transform" :class="{ 'rotate-90': open }" />
        {{ title }}
      </button>
      <h4 v-else class="text-[9px] font-semibold text-muted uppercase tracking-wider">{{ title }}</h4>
      <slot name="actions" />
    </div>
    <slot v-if="!collapsible || open" />
  </div>
</template>
