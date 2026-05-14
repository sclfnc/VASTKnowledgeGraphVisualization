<script setup>
// EXTENSION: Guide view — orchestrates schema, active panels, focus modal.
// Sidebar Contents and focus modal live in dedicated components.
import { ref, watch, computed, nextTick } from 'vue'
import GuidePanel from '../components/GuidePanel.vue'
import GuideContents from '../components/GuideContents.vue'
import PanelFocus from '../components/PanelFocus.vue'
import { PANEL_SPECS, SECTIONS } from '../wikiPanels/index.js'
import { useLocalStorage } from '../composables/useLocalStorage.js'
import { useSchema } from '../composables/useSchema.js'
import { useFiltersStore } from '../stores/filters.js'
import { storeToRefs } from 'pinia'
import { useGraphStore } from '../stores/graph.js'
import FiltersPanel from '../components/FiltersPanel.vue'
import NumericFilter from '../components/NumericFilter.vue'
import { Eye, EyeOff, RotateCw, X } from 'lucide-vue-next'

const { schema } = useSchema()
const { graphId } = storeToRefs(useGraphStore())
const filters = useFiltersStore()

const activeIds = useLocalStorage('guide_active_panels', PANEL_SPECS.filter(p => p.defaultActive).map(p => p.id))
const panels = ref(PANEL_SPECS.map(p => ({ ...p, active: activeIds.value.includes(p.id) })))

watch(panels, () => { activeIds.value = panels.value.filter(p => p.active).map(p => p.id) }, { deep: true })

const focused = ref(null)

const orderedActive = computed(() =>
  panels.value
    .filter(p => p.active && p.component)
    .sort((a, b) => {
      const activeOrder = panels.value.filter(p => p.active).map(p => p.id)
      return activeOrder.indexOf(a.id) - activeOrder.indexOf(b.id)
    })
)

const toggle = (p) => { if (!p.conditional) p.active = !p.active }
const loadSection = (s) => panels.value.filter(p => p.section === s && !p.conditional).forEach(p => { p.active = true })
const removeSection = (s) => panels.value.filter(p => p.section === s).forEach(p => { p.active = false })

function toggleType(list, value) {
  const i = list.indexOf(value)
  if (i === -1) list.push(value); else list.splice(i, 1)
}

// Per-panel UI state lives here so we can render the settings as a sibling
// grid item right after the card (occupies the adjacent column).
// - expandedId: explicit user request for "big" (col-span-2 + row-span-2)
// - widenedId:  side-effect of opening settings (col-span-2 only). Sticks
//               after the drawer closes so the chart doesn't shrink back.
// - controlsOpenId: which panel currently shows the drawer
const expandedId = ref(null)
const widenedId = ref(null)
const controlsOpenId = ref(null)
const drawerReady = ref(false)
const drawerId = `panel-drawer-${Math.random().toString(36).slice(2, 8)}`

function toggleExpand(id) {
  // Pure size toggle. If the card is currently enlarged in any way
  // (expanded big OR widened by settings), shrink it back to default and
  // close the drawer. Otherwise enlarge it to big and close the drawer
  // (they'd compete for the adjacent column).
  const isEnlarged = expandedId.value === id || widenedId.value === id
  if (isEnlarged) {
    expandedId.value = null
    widenedId.value = null
  } else {
    expandedId.value = id
    widenedId.value = null
  }
  controlsOpenId.value = null
  drawerReady.value = false
}

function toggleControls(id) {
  if (controlsOpenId.value === id) {
    controlsOpenId.value = null
    drawerReady.value = false
    // Keep widenedId set: the chart stays at col-span-2 until the user
    // explicitly shrinks via the resize button.
  } else {
    controlsOpenId.value = id
    widenedId.value = id
    nextTick(() => { drawerReady.value = true })
  }
}
</script>

<template>
  <div class="flex gap-3 items-start">

    <!-- left sidebar: contents -->
    <aside class="scrollbar-slim sticky top-16 h-[calc(100vh-5rem)] w-56 shrink-0 overflow-y-auto rounded-xl bg-white px-4 py-3">
      <GuideContents
        :panels="panels"
        :sections="SECTIONS"
        @toggle="toggle"
        @load-section="loadSection"
        @remove-section="removeSection"
      />
    </aside>

    <!-- main column -->
    <div class="flex min-w-0 flex-1 flex-col gap-3">

    <!-- filter bar + graph overview unified -->
    <div v-if="schema" class="rounded-xl bg-white px-4 py-3 space-y-3">

      <!-- graph name + metadata row -->
      <div class="flex flex-wrap items-center gap-x-2 gap-y-1 text-xs text-slate-500">
        <span class="text-sm font-semibold text-slate-800 mr-1">{{ schema.name ?? 'Graph' }}</span>
        <span class="font-medium text-slate-700">{{ schema.nodes }}</span><span>nodes</span>
        <span class="text-slate-300">·</span>
        <span class="font-medium text-slate-700">{{ schema.edges }}</span><span>edges</span>
        <span class="text-slate-300">·</span>
        <span>{{ schema.directed ? 'Directed' : 'Undirected' }}</span>
        <template v-if="schema.multigraph">
          <span class="text-slate-300">·</span>
          <span>Multigraph</span>
        </template>
        <span class="text-slate-300">·</span>
        <span>{{ schema.weighted ? 'Weighted' : 'Unweighted' }}</span>
        <template v-if="schema.node_types?.length > 1">
          <span class="text-slate-300">·</span>
          <span>{{ schema.node_types.length }} node types</span>
        </template>
        <template v-if="schema.edge_types?.length > 1">
          <span class="text-slate-300">·</span>
          <span>{{ schema.edge_types.length }} edge types</span>
        </template>
        <template v-if="schema.self_loops > 0">
          <span class="text-slate-300">·</span>
          <span class="text-amber-600">{{ schema.self_loops }} self-loop{{ schema.self_loops > 1 ? 's' : '' }}</span>
        </template>
        <template v-if="schema.acyclic === true">
          <span class="text-slate-300">·</span>
          <span class="text-emerald-600">DAG</span>
        </template>
      </div>

      <div class="border-t border-slate-100" />

      <div class="flex flex-wrap items-center gap-2">
        <!-- node types -->
        <div v-if="schema.node_types?.length" class="flex flex-wrap items-center gap-1.5">
          <span class="text-[10px] font-semibold text-slate-400 uppercase tracking-wide">Nodes</span>
          <button
            v-for="t in schema.node_types" :key="t"
            class="rounded-full border px-2 py-0.5 text-[11px] font-medium transition-colors"
            :class="filters.nodeTypes.includes(t)
              ? 'border-sky-500 bg-sky-50 text-sky-700'
              : 'border-slate-200 bg-white text-slate-500 hover:border-slate-300'"
            @click="toggleType(filters.nodeTypes, t)">
            {{ t }}
          </button>
        </div>

        <div v-if="schema.node_types?.length && schema.edge_types?.length" class="h-4 w-px bg-slate-200 shrink-0" />

        <!-- edge types -->
        <div v-if="schema.edge_types?.length" class="flex flex-wrap items-center gap-1.5">
          <span class="text-[10px] font-semibold text-slate-400 uppercase tracking-wide">Edges</span>
          <button
            v-for="t in schema.edge_types" :key="t"
            class="rounded-full border px-2 py-0.5 text-[11px] font-medium transition-colors"
            :class="filters.edgeTypes.includes(t)
              ? 'border-violet-500 bg-violet-50 text-violet-700'
              : 'border-slate-200 bg-white text-slate-500 hover:border-slate-300'"
            @click="toggleType(filters.edgeTypes, t)">
            {{ t }}
          </button>
        </div>

        <div class="h-4 w-px bg-slate-200 shrink-0" />

        <!-- toggles -->
        <div class="flex items-center gap-3">
          <button
            class="flex items-center gap-1 text-[11px] transition"
            :class="filters.hideIsolated ? 'text-red-500 hover:text-red-600' : 'text-slate-400 hover:text-slate-600'"
            @click="filters.hideIsolated = !filters.hideIsolated">
            <component :is="filters.hideIsolated ? EyeOff : Eye" :size="12" />
            <span>Isolated</span>
          </button>
          <button
            class="flex items-center gap-1 text-[11px] transition"
            :class="filters.hideSelfLoops ? 'text-red-500 hover:text-red-600' : 'text-slate-400 hover:text-slate-600'"
            @click="filters.hideSelfLoops = !filters.hideSelfLoops">
            <RotateCw :size="12" />
            <span>Self-loops</span>
          </button>
        </div>
      </div>

      <!-- second row: numeric filters + selected nodes -->
      <div class="flex flex-wrap items-start gap-6 border-t border-slate-100 pt-3">
        <NumericFilter v-model="filters.degree" :range="schema.degree_range" label="Degree" />
        <NumericFilter v-if="schema.weighted" v-model="filters.weight" :range="schema.weight_range" label="Edge weight" />

        <div v-if="filters.selected.length" class="flex flex-col gap-1">
          <div class="flex items-center justify-between gap-4">
            <span class="text-xs font-medium text-slate-600">Selected nodes</span>
            <button class="text-[10px] text-slate-400 hover:text-red-400" @click="filters.selected = []">clear</button>
          </div>
          <ul class="flex flex-wrap gap-1">
            <li v-for="(id, i) in filters.selected" :key="id" class="flex items-center gap-1 rounded bg-slate-100 px-1.5 py-0.5 text-[10px] text-slate-700">
              <span class="max-w-[7rem] truncate">{{ id }}</span>
              <button class="text-slate-400 hover:text-red-400" @click="filters.selected.splice(i, 1)"><X :size="10" /></button>
            </li>
          </ul>
          <div class="flex items-center justify-between text-[10px] text-slate-500">
            <span>Neighborhood</span>
            <span>{{ filters.hops === -1 ? 'all' : `${filters.hops}-hop` }}</span>
          </div>
          <input type="range" min="-1" max="5" v-model.number="filters.hops" class="w-full">
        </div>
      </div>

    </div>

    <!-- panels grid -->
    <div v-if="!orderedActive.length" class="flex h-48 items-center justify-center text-sm text-slate-400">
      Select a panel from Contents ←
    </div>

    <div class="grid auto-rows-min grid-cols-3 gap-4">
      <template v-for="p in orderedActive" :key="p.id">
        <GuidePanel
          :panelSpec="p"
          :schema="schema"
          :graphId="graphId"
          :expanded="expandedId === p.id"
          :widened="widenedId === p.id"
          :controlsOpen="controlsOpenId === p.id"
          :drawerId="drawerId"
          :drawerReady="drawerReady && controlsOpenId === p.id"
          @remove="toggle(p)"
          @focus="focused = p"
          @toggle-expand="toggleExpand(p.id)"
          @toggle-controls="toggleControls(p.id)"
        />
        <!-- drawer slot: sits in the column adjacent to the (col-span-2) card -->
        <div v-if="controlsOpenId === p.id" class="min-w-0 flex flex-col gap-2 pt-3">
          <div class="flex items-center justify-between px-1">
            <span class="text-xs font-semibold text-slate-500 uppercase tracking-wider">Settings</span>
            <button class="text-slate-400 hover:text-slate-700" title="Close" @click="toggleControls(p.id)">
              <X :size="14" />
            </button>
          </div>
          <div :id="drawerId" class="scrollbar-slim overflow-y-auto" />
        </div>
      </template>
    </div>

    </div><!-- end main column -->
  </div>

  <PanelFocus :panel="focused" :schema="schema" :graphId="graphId" @close="focused = null" />
</template>
