<script setup>
import { ref, computed, inject } from 'vue'
import {
  Search, ChevronDown, ChevronRight, Plus, X,
  Network, BarChart3, Target, Triangle, Shuffle, Sparkles, Shield, Clock, Layers, Users, Link2, BookOpen,
} from 'lucide-vue-next'
import { storeToRefs } from 'pinia'
import { usePanelsStore } from '../stores/panels.js'
import { injectSchema } from '../composables/useSchema.js'

// Centrality status injected by GuideView (single global poller). Defaults to
// null when GuideView isn't the parent (e.g. /dataset onboarding view).
const centralityStatus = inject('centralityStatus', null)

// Maps a panel.id → the status key in centralityStatus.value.
const CENTRALITY_KEY = {
  cent_pagerank: 'spectral',      // PR + Eig share the spectral status
  cent_eigenvector: 'spectral',
  cent_betweenness: 'betweenness',
  cent_closeness: 'closeness',
  cent_compare: 'comparison',
}

const BADGE_LABELS = {
  pending: 'Pending', computing: 'Computing', ready: 'Done',
  error: 'Error', cancelled: 'Cancelled',
}
const BADGE_CLASS = {
  pending: 'badge-pending', computing: 'badge-computing', ready: 'badge-done',
  error: 'badge-error', cancelled: 'badge-cancelled',
}

function centralityBadge(panel) {
  if (!centralityStatus?.value) return null
  const key = CENTRALITY_KEY[panel.id]
  if (!key) return null
  const state = centralityStatus.value[key] ?? 'pending'
  return { state, label: BADGE_LABELS[state] ?? state, cls: BADGE_CLASS[state] ?? 'badge-pending' }
}

const panelsStore = usePanelsStore()
const { panels, sections } = storeToRefs(panelsStore)
const { toggle, loadSection, removeSection } = panelsStore
const { schema } = injectSchema()

// A panel may declare `available(schema)` to opt out of the registry on graphs
// where it would render nothing (e.g. attribute-schema panels on a graph whose
// types carry no extra attributes). Absence of the predicate = always available.
const isAvailable = (p) => typeof p.available !== 'function' || p.available(schema.value)

const search = ref('')
const collapsed = ref(Object.fromEntries(sections.value.map(s => [s, false])))

const SECTION_ICONS = {
  Fundamentals: Network,
  'Descriptive Metrics': BarChart3,
  Centrality: Target,
  'Local Structure': Triangle,
  'Mixing & Assortativity': Shuffle,
  'Generative Models': Sparkles,
  Resilience: Shield,
  'Temporal Analysis': Clock,
  'Heterogeneous Structure': Layers,
  'Community Detection': Users,
  'Link Prediction': Link2,
}

const sectionIcon = (s) => SECTION_ICONS[s] ?? BookOpen

const panelsInSection = (s) => panels.value.filter(p => p.section === s && isAvailable(p))
const togglablePanelsInSection = (s) => panelsInSection(s).filter(p => !p.conditional)
const isSectionFull = (s) => {
  const togglable = togglablePanelsInSection(s)
  return togglable.length > 0 && togglable.every(p => p.active)
}
const filteredPanels = (s) => panelsInSection(s).filter(p => p.label.toLowerCase().includes(search.value.toLowerCase()))
const visibleSections = computed(() => sections.value.filter(s => !search.value || filteredPanels(s).length))

const toggleSection = (s) => {
  if (isSectionFull(s)) removeSection(s)
  else loadSection(s)
}
</script>

<template>
  <div class="flex flex-col gap-2">
    <div class="relative">
      <Search :size="12" class="pointer-events-none absolute left-2 top-1/2 -translate-y-1/2 text-secondary" />
      <input
        v-model="search"
        type="text"
        placeholder="Search…"
        class="input-base w-full rounded-md py-1 pl-7 pr-2 text-xs"
      />
    </div>

    <ul>
      <li
        v-for="s in visibleSections"
        :key="s"
        class="border-t border-slate-200 py-2 first:border-t-0 first:pt-0"
      >
        <div
          class="group cursor-pointer flex items-center gap-1.5"
          :class="{ 'pb-1': !collapsed[s] }"
          @click="collapsed[s] = !collapsed[s]">
          <component :is="sectionIcon(s)" :size="14" class="text-primary" :stroke-width="1.75" />
          <h3 class="flex-1 text-sm font-semibold text-primary">{{ s }}</h3>
          <component :is="collapsed[s] ? ChevronRight : ChevronDown" :size="11" class="text-secondary" />
        </div>
        <ul v-if="!collapsed[s]" class="ml-3 space-y-0.5">
          <li>
            <button
              class="flex items-center gap-1 text-[10px] hover:font-semibold"
              :class="isSectionFull(s) ? 'text-secondary hover:text-red-500' : 'text-secondary hover:text-primary'"
              @click="toggleSection(s)"
            >
              <component :is="isSectionFull(s) ? X : Plus" :size="10" />
              <span>{{ isSectionFull(s) ? 'remove all' : 'load all' }}</span>
            </button>
          </li>
          <li
            v-for="p in filteredPanels(s)"
            :key="p.id"
            class="flex items-center gap-1.5 text-xs cursor-pointer transition"
            :class="p.conditional
              ? 'cursor-not-allowed text-muted'
              : p.active
                ? 'font-semibold text-primary'
                : p.status === 'stub'
                  ? 'text-muted hover:text-secondary'
                  : 'text-secondary hover:text-primary'"
            @click="!p.conditional && toggle(p)"
          >
            <span class="flex-1 truncate">{{ p.label }}</span>
            <span
              v-if="centralityBadge(p)"
              :class="['badge-base', centralityBadge(p).cls]"
            >{{ centralityBadge(p).label }}</span>
          </li>
        </ul>
      </li>
    </ul>
  </div>
</template>
