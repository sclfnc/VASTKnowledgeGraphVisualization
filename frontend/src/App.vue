<script setup>
import { RouterLink, RouterView } from 'vue-router'
import { ref, onMounted, onUnmounted } from 'vue'
import { Database, ChevronDown, Upload, Network, BookOpen, Info, Telescope } from 'lucide-vue-next'
import { useGraphStore } from './stores/graph.js'
import { useDatasetLoader, fetchDatasets } from './composables/useDatasetLoader.js'
import AboutModal from './components/AboutModal.vue'

const modes = [
  { key: 'graph', label: 'Graph', icon: Network },
  { key: 'guide', label: 'Guide', icon: BookOpen },
]

const aboutOpen = ref(false)

const graphStore = useGraphStore()
const { loadBuiltin } = useDatasetLoader()

// EXTENSION: dataset switcher dropdown
const datasets = ref([])
const dropdownOpen = ref(false)

const onClickOutside = (e) => {
  if (!e.target.closest('.dataset-dropdown')) dropdownOpen.value = false
}

onMounted(async () => {
  datasets.value = await fetchDatasets()
  document.addEventListener('click', onClickOutside)
})
onUnmounted(() => document.removeEventListener('click', onClickOutside))

async function switchDataset(name) {
  if (!confirm('Changing dataset will reset the current view. Continue?')) return
  dropdownOpen.value = false
  await loadBuiltin(name)
}
</script>

<template>
  <div class="min-h-screen bg-slate-50">
    <header class="sticky top-0 z-10 border-b border-slate-200 bg-white/90 px-4 py-3 backdrop-blur md:px-6">
      <div class="mx-auto flex max-w-7xl flex-wrap items-center justify-between gap-3">
        <div class="flex items-center gap-2.5">
          <Telescope :size="28" class="text-slate-800" :stroke-width="1.75" />
          <div>
            <h1 class="text-lg font-semibold leading-tight text-slate-900 md:text-xl">Telescope</h1>
            <p class="text-xs text-slate-500">Zoom into your graph</p>
          </div>
        </div>

        <nav class="flex flex-wrap items-center gap-2">
          <button
            class="flex items-center gap-1.5 rounded-md px-3 py-2 text-sm text-slate-600 transition hover:bg-slate-100 hover:text-slate-900"
            @click="aboutOpen = true"
          >
            <Info :size="14" />
            <span>About</span>
          </button>

          <!-- EXTENSION: dataset switcher dropdown -->
          <div v-if="graphStore.graphId" class="dataset-dropdown relative">
            <button
              class="flex items-center gap-1.5 rounded-md px-3 py-2 text-sm text-slate-600 transition hover:bg-slate-100 hover:text-slate-900"
              @click="dropdownOpen = !dropdownOpen"
            >
              <Database :size="14" />
              <span>Dataset</span>
              <ChevronDown :size="14" :class="dropdownOpen ? 'rotate-180 transition' : 'transition'" />
            </button>
            <div
              v-if="dropdownOpen"
              class="absolute right-0 top-full z-20 mt-1 w-48 rounded-md border border-slate-200 bg-white shadow-md"
            >
              <button
                v-for="ds in datasets"
                :key="ds.name"
                class="block w-full px-4 py-2 text-left text-sm text-slate-600 hover:bg-slate-50"
                :class="graphStore.graphId === `builtin_${ds.name}` ? 'font-semibold text-slate-900' : ''"
                @click="switchDataset(ds.name)"
              >{{ ds.name }}</button>
              <div class="border-t border-slate-100">
                <RouterLink
                  to="/dataset"
                  class="flex items-center gap-1.5 px-4 py-2 text-sm text-slate-400 hover:bg-slate-50"
                  @click="dropdownOpen = false"
                >
                  <Upload :size="14" />
                  <span>Upload file…</span>
                </RouterLink>
              </div>
            </div>
          </div>

          <!-- EXTENSION: mode toggle -->
          <div v-if="graphStore.graphId" class="ml-2 flex rounded-md border border-slate-200 bg-white">
            <button
              v-for="m in modes"
              :key="m.key"
              class="flex items-center gap-1.5 px-4 py-1.5 text-sm transition"
              :class="graphStore.mode === m.key ? 'bg-slate-900 text-white' : 'text-slate-500 hover:text-slate-900'"
              @click="graphStore.setMode(m.key)"
            >
              <component :is="m.icon" :size="14" />
              <span>{{ m.label }}</span>
            </button>
          </div>
        </nav>
      </div>
    </header>

    <main class="mx-auto w-full max-w-7xl p-4 md:p-6">
      <RouterView />
    </main>

    <AboutModal :open="aboutOpen" @close="aboutOpen = false" />
  </div>
</template>
