<script setup>
// EXTENSION: right sidebar of the Guide view — search + sectioned panel list.
// Pure UI: receives panels and emits intents.
import { ref, computed } from 'vue'
import {
  Search, ChevronDown, ChevronRight, Plus, X, Check, Circle,
  Network, BarChart3, Target, Triangle, Shuffle, Sparkles, Shield, Clock, Layers, Users, Link2, BookOpen,
} from 'lucide-vue-next'

const props = defineProps({
  panels:   { type: Array, required: true },
  sections: { type: Array, required: true },
})
const emit = defineEmits(['toggle', 'load-section', 'remove-section'])

const search = ref('')
const collapsed = ref(Object.fromEntries(props.sections.map(s => [s, false])))

const SECTION_ICONS = {
  'Fundamentals': Network,
  'Descriptive Metrics': BarChart3,
  'Centrality': Target,
  'Local Structure': Triangle,
  'Mixing & Assortativity': Shuffle,
  'Generative Models': Sparkles,
  'Resilience': Shield,
  'Temporal Analysis': Clock,
  'Heterogeneous Structure': Layers,
  'Community Detection': Users,
  'Link Prediction': Link2,
}

// Section numbering is derived from the current order of sections (1-based).
// This way, hiding a section in the registry doesn't leave gaps in the UI.
const parseSection = (s) => ({ num: String(props.sections.indexOf(s) + 1), name: s })
const sectionIcon = (s) => SECTION_ICONS[s] ?? BookOpen

const panelsInSection = (s) => props.panels.filter(p => p.section === s)
const togglablePanelsInSection = (s) => panelsInSection(s).filter(p => !p.conditional)
const activeCount = (s) => togglablePanelsInSection(s).filter(p => p.active).length
const isSectionFull = (s) => {
  const togglable = togglablePanelsInSection(s)
  return togglable.length > 0 && togglable.every(p => p.active)
}
const filteredPanels = (s) => panelsInSection(s).filter(p => p.label.toLowerCase().includes(search.value.toLowerCase()))
const visibleSections = computed(() => props.sections.filter(s => !search.value || filteredPanels(s).length))

const toggleSection = (s) => {
  if (isSectionFull(s)) emit('remove-section', s)
  else emit('load-section', s)
}
</script>

<template>
  <p class="mb-3 text-xs font-semibold text-slate-400">Contents</p>
  <div class="relative mb-4">
    <Search :size="12" class="pointer-events-none absolute left-2 top-1/2 -translate-y-1/2 text-slate-400" />
    <input
      v-model="search"
      type="text"
      placeholder="Search…"
      class="w-full rounded border border-slate-200 py-1 pl-7 pr-2 text-xs text-slate-700 outline-none focus:border-slate-400"
    />
  </div>
  <ul class="space-y-3">
    <li v-for="s in visibleSections" :key="s">
      <div class="group flex cursor-pointer items-center gap-1.5" @click="collapsed[s] = !collapsed[s]">
        <component :is="collapsed[s] ? ChevronRight : ChevronDown" :size="12" class="text-slate-400" />
        <span class="flex h-4 w-4 shrink-0 items-center justify-center rounded bg-slate-100 text-[9px] font-semibold text-slate-500 group-hover:bg-slate-200">{{ parseSection(s).num }}</span>
        <component :is="sectionIcon(s)" :size="12" class="text-slate-400 group-hover:text-slate-600" :stroke-width="1.75" />
        <p class="flex-1 text-xs font-semibold text-slate-500 group-hover:text-slate-700">{{ parseSection(s).name }}</p>
      </div>
      <ul v-if="!collapsed[s]" class="ml-4 mt-1 space-y-0.5">
        <li class="pb-1">
          <button
            class="flex items-center gap-1 text-xs hover:font-medium"
            :class="isSectionFull(s) ? 'text-slate-400 hover:text-red-400' : 'text-slate-400 hover:text-slate-700'"
            @click="toggleSection(s)"
          >
            <component :is="isSectionFull(s) ? X : Plus" :size="11" />
            <span>{{ isSectionFull(s) ? 'remove all' : 'load all' }}</span>
          </button>
        </li>
        <li
          v-for="p in filteredPanels(s)"
          :key="p.id"
          class="flex items-center gap-1.5 text-sm"
          :class="p.conditional
            ? 'cursor-not-allowed text-slate-300'
            : p.active
              ? 'cursor-pointer font-semibold text-slate-900'
              : 'cursor-pointer text-slate-400 hover:text-slate-700'"
          @click="!p.conditional && emit('toggle', p)"
        >
          <component :is="p.active ? Check : Circle" :size="10" />
          {{ p.label }}
        </li>
      </ul>
    </li>
  </ul>
</template>
