<script setup>
import { ref, computed, inject } from 'vue'
import {
  Search, ChevronDown, ChevronRight, Plus, X, Info,
  Network, BarChart3, Target, Triangle, Shuffle, Sparkles, Shield, Clock, Layers, Users, Link2, BookOpen, Telescope,
} from 'lucide-vue-next'
import { storeToRefs } from 'pinia'
import { useGraphStore } from '../stores/graph.js'
import { usePanelsStore } from '../stores/panels.js'
import { useAboutModal } from '../composables/useAboutModal.js'
import DatasetDropdown from './DatasetDropdown.vue'
import ModeToggle from './ModeToggle.vue'

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

const graphStore = useGraphStore()
const panelsStore = usePanelsStore()
const { panels, sections } = storeToRefs(panelsStore)
const { toggle, loadSection, removeSection } = panelsStore
const { openAbout } = useAboutModal()

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

const panelsInSection = (s) => panels.value.filter(p => p.section === s)
const togglablePanelsInSection = (s) => panelsInSection(s).filter(p => !p.conditional)
const activePanelsInSection = (s) => panelsInSection(s).filter(p => p.active).length
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
  <div class="flex min-h-full flex-col">
    <!-- Brand -->
    <div class="mb-3 text-center">
      <div class="inline-flex items-center justify-center gap-2 text-on-dark-primary">
        <Telescope :size="26" :stroke-width="2" />
        <span class="text-2xl font-bold leading-none">Telescope</span>
      </div>
      <p class="mt-1 text-xs font-medium uppercase tracking-wide text-on-dark-secondary">Zoom into your graph</p>
    </div>

    <!-- Mode toggle: immediately under the brand -->
    <div v-if="graphStore.graphId" class="mb-5 flex justify-center">
      <ModeToggle dark-scope />
    </div>

    <!-- Contents (Guide-mode only) — irrelevant in Graph mode, hide it. -->
    <template v-if="graphStore.mode === 'guide'">
      <p class="mb-3 text-base font-bold leading-6 text-on-dark-primary">Contents</p>
      <div class="relative mb-4">
        <Search :size="12" class="pointer-events-none absolute left-2 top-1/2 -translate-y-1/2 text-on-dark-muted" />
        <input
          v-model="search"
          type="text"
          placeholder="Search…"
          class="surface-dark-recessed border-dark text-on-dark-primary placeholder:text-on-dark-muted w-full rounded-md border py-1 pl-7 pr-2 text-xs focus:outline-none"
        />
      </div>

      <!-- Sections — top border acts as separator between sections (first has no border). -->
      <ul>
      <li
        v-for="s in visibleSections"
        :key="s"
        class="border-t border-dark py-3 first:border-t-0 first:pt-0"
      >
        <div
          class="group cursor-pointer flex items-center gap-1.5"
          :class="{ 'pb-2': !collapsed[s] }"
          @click="collapsed[s] = !collapsed[s]">

          <component :is="sectionIcon(s)" :size="16" class="text-on-dark-primary" :stroke-width="1.75" />
          <p class="flex-1 text-base font-semibold text-on-dark-primary">{{ s }}</p>
          <span class="text-xs text-on-dark-muted">{{ activePanelsInSection(s) }}/{{ panelsInSection(s).length }}</span>
          <component :is="collapsed[s] ? ChevronRight : ChevronDown" :size="12" class="text-on-dark-muted" />
        </div>
        <ul v-if="!collapsed[s]" class="ml-4 space-y-0.5">
          <li>
            <button
              class="flex items-center gap-1 text-xs hover:font-medium"
              :class="isSectionFull(s) ? 'text-on-dark-muted hover:text-red-300' : 'text-on-dark-muted hover:text-on-dark-primary'"
              @click="toggleSection(s)"
            >
              <component :is="isSectionFull(s) ? X : Plus" :size="11" />
              <span>{{ isSectionFull(s) ? 'remove all' : 'load all' }}</span>
            </button>
          </li>
          <li
            v-for="p in filteredPanels(s)"
            :key="p.id"
            class="flex items-center gap-1.5 text-sm cursor-pointer transition"
            :class="p.conditional
              ? 'cursor-not-allowed text-on-dark-muted'
              : p.active
                ? 'font-semibold text-on-dark-primary'
                : p.status === 'stub'
                  ? 'text-on-dark-muted hover:text-on-dark-secondary'
                  : 'text-on-dark-secondary hover:text-on-dark-primary'"
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
    </template>

    <!-- Footer: Dataset + About side by side -->
    <div v-if="graphStore.graphId" class="mt-auto border-t border-dark pt-4">
      <div class="grid grid-cols-2 gap-2">
        <DatasetDropdown dark-scope full-width />
        <div class="segmented-track segmented-track--dark inline-flex items-center">
          <button
            class="segmented-pill inline-flex w-full items-center justify-center gap-1.5 px-3 py-0.5 text-sm"
            @click="openAbout"
          >
            <Info :size="14" />
            <span>About</span>
          </button>
        </div>
      </div>
    </div>
  </div>
</template>
