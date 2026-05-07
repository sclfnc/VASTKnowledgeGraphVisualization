<script setup>
// EXTENSION: Guide view — orchestrates schema, active panels, focus modal.
// Sidebar Contents and focus modal live in dedicated components.
import { ref, watch } from 'vue'
import GuidePanel from '../components/GuidePanel.vue'
import GraphOverview from '../components/GraphOverview.vue'
import FiltersPanel from '../components/FiltersPanel.vue'
import GuideContents from '../components/GuideContents.vue'
import PanelFocus from '../components/PanelFocus.vue'
import { PANELS, SECTIONS } from '../data/panels.js'
import { useLocalStorage } from '../composables/useLocalStorage.js'
import { useSchema } from '../composables/useSchema.js'

const { schema } = useSchema()

const activeIds = useLocalStorage('guide_active_panels', PANELS.filter(p => p.defaultActive).map(p => p.id))
const panels = ref(PANELS.map(p => ({ ...p, active: activeIds.value.includes(p.id) })))

watch(panels, () => { activeIds.value = panels.value.filter(p => p.active).map(p => p.id) }, { deep: true })

const focused = ref(null)

const orderedActive = ref(panels.value.filter(p => p.active))
watch(
  () => panels.value.filter(p => p.active).map(p => p.id),
  (ids) => {
    orderedActive.value = [
      ...orderedActive.value.filter(p => ids.includes(p.id)),
      ...panels.value.filter(p => p.active && !orderedActive.value.find(o => o.id === p.id)),
    ]
  }
)

const toggle = (p) => { if (!p.conditional) p.active = !p.active }
const loadSection = (s) => panels.value.filter(p => p.section === s && !p.conditional).forEach(p => { p.active = true })
const removeSection = (s) => panels.value.filter(p => p.section === s).forEach(p => { p.active = false })
const clearAll = () => panels.value.forEach(p => { p.active = false })
</script>

<template>
  <div class="flex gap-6">

    <aside class="sticky top-16 h-[calc(100vh-5rem)] w-52 shrink-0 overflow-y-auto">
      <p class="mb-3 text-xs font-semibold text-slate-400">Filters</p>
      <FiltersPanel :schema="schema" />
    </aside>

    <section class="flex-1">
      <GraphOverview
        :name="schema?.name ?? 'Graph'"
        :nodes="schema?.nodes ?? 0"
        :edges="schema?.edges ?? 0"
        :directed="schema?.directed ?? false"
        :multigraph="schema?.multigraph ?? false"
        :weighted="schema?.weighted ?? false"
        :bipartite="schema?.bipartite ?? false"
        :node-types="schema?.node_types?.length ?? 0"
        :edge-types="schema?.edge_types?.length ?? 0"
        :self-loops="schema?.self_loops ?? 0"
        :acyclic="schema?.acyclic ?? null"
      />

      <div v-if="orderedActive.length" class="mb-4 flex justify-end">
        <button class="text-xs text-slate-400 hover:text-red-400" @click="clearAll">clear all</button>
      </div>

      <div v-if="!orderedActive.length" class="flex h-48 items-center justify-center text-sm text-slate-400">
        Select a panel from Contents →
      </div>

      <div class="grid auto-rows-min grid-cols-2 gap-4">
        <GuidePanel
          v-for="p in orderedActive"
          :key="p.id"
          :title="p.label"
          :section="p.section"
          :explanation="p.explanation"
          @remove="toggle(p)"
          @focus="focused = p"
        >
          <div class="flex h-32 items-center justify-center rounded bg-slate-50 text-xs text-slate-400">
            chart placeholder — {{ p.label }}
          </div>
        </GuidePanel>
      </div>
    </section>

    <aside class="sticky top-16 h-[calc(100vh-5rem)] w-48 shrink-0 overflow-y-auto">
      <GuideContents
        :panels="panels"
        :sections="SECTIONS"
        @toggle="toggle"
        @load-section="loadSection"
        @remove-section="removeSection"
      />
    </aside>

  </div>

  <PanelFocus :panel="focused" @close="focused = null" />
</template>
