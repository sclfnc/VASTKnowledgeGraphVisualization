<script setup>
// Onboarding: a single self-contained card. Branding header (Telescope + tagline + About),
// short orientation copy, list of sources (built-in datasets + upload), explicit Load button.
// Two-step flow: click a tile to select it (mutually exclusive: built-in vs upload),
// then click Load. Prevents accidental loads from misclicks.
// Drop a JSON file anywhere on the page to upload via drag & drop.
import { ref, computed, onMounted } from 'vue'
import { useRouter } from 'vue-router'
import { Telescope, Upload, FileJson, X, Info, ArrowRight } from 'lucide-vue-next'
import { useAboutModal } from '../composables/useAboutModal.js'
import { useDatasetLoader, fetchDatasets } from '../composables/useDatasetLoader.js'

const router = useRouter()
const { openAbout } = useAboutModal()
const { loading, error, loadBuiltin, uploadFile } = useDatasetLoader()

const DATASET_META = {
  karate: {
    blurb: 'Social network of a university karate club, split into two factions after a leadership dispute between the instructor and the administrator.',
    source: { label: 'NetworkX', url: 'https://networkx.org/documentation/stable/reference/generated/networkx.generators.social.karate_club_graph.html', license: null },
  },
  les_miserables: {
    blurb: "Co-appearance network from Victor Hugo's novel. Two characters are linked if they share a chapter; edges weighted by frequency.",
    source: { label: 'NetworkX', url: 'https://networkx.org/documentation/stable/reference/generated/networkx.generators.social.les_miserables_graph.html', license: null },
  },
  florentine: {
    blurb: 'Marriage alliances among powerful Florentine families in 15th-century Renaissance Italy. Nodes are families, edges are matrimonial ties.',
    source: { label: 'NetworkX', url: 'https://networkx.org/documentation/stable/reference/generated/networkx.generators.social.florentine_families_graph.html', license: null },
  },
  davis: {
    blurb: 'Bipartite network recording women\'s attendance at social events in 1930s Mississippi. Nodes are women and events.',
    source: { label: 'NetworkX', url: 'https://networkx.org/documentation/stable/reference/generated/networkx.generators.social.davis_southern_women_graph.html', license: null },
  },
  email_eu_core: {
    blurb: 'Directed email network from a European research institution. Nodes are researchers by department; edges represent emails exchanged.',
    source: { label: 'SNAP / Stanford', url: 'https://snap.stanford.edu/data/email-Eu-core.html', license: 'BSD' },
  },
  movielens_small: {
    blurb: 'Bipartite rating network linking users to movies. Edges carry the rating score as weight and the submission date as a temporal attribute.',
    source: { label: 'GroupLens', url: 'https://grouplens.org/datasets/movielens/', license: 'CC BY 4.0' },
  },
}

const builtins = ref([])
const selectedBuiltin = ref(null)
const pickedFile = ref(null)
const graphName = ref('')
const dragOver = ref(false)
const fileInput = ref(null)

onMounted(async () => { builtins.value = await fetchDatasets() })

// Built-in and upload are mutually exclusive: picking one clears the other.
function selectBuiltin(name) {
  selectedBuiltin.value = name
  pickedFile.value = null
  graphName.value = ''
}

function setFile(file) {
  if (!file) return
  if (!file.name.toLowerCase().endsWith('.json')) return
  pickedFile.value = file
  selectedBuiltin.value = null
}

function clearFile() {
  pickedFile.value = null
  graphName.value = ''
  if (fileInput.value) fileInput.value.value = ''
}

function onPick(e) { setFile(e.target.files[0]) }

function onDrop(e) {
  dragOver.value = false
  setFile(e.dataTransfer.files[0])
}

const canLoad = computed(() => !loading.value && (selectedBuiltin.value || pickedFile.value))

async function onLoad() {
  if (!canLoad.value) return
  let data = null
  if (pickedFile.value) {
    data = await uploadFile(pickedFile.value, graphName.value.trim() || null)
  } else if (selectedBuiltin.value) {
    data = await loadBuiltin(selectedBuiltin.value)
  }
  if (data) router.push({ name: 'home' })
}

function fmtSize(bytes) {
  if (bytes < 1024) return `${bytes} B`
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`
  return `${(bytes / 1024 / 1024).toFixed(1)} MB`
}
</script>

<template>
  <main
    class="flex min-h-screen items-center justify-center px-4 py-8"
    @dragover.prevent="dragOver = true"
    @dragleave.prevent="dragOver = false"
    @drop.prevent="onDrop"
  >
    <div class="card-elev w-full max-w-2xl rounded-2xl p-8">

      <!-- Header -->
      <div class="mb-6 flex items-start justify-between gap-4">
        <div class="flex items-center gap-3">
          <Telescope :size="32" class="text-primary shrink-0" :stroke-width="1.75" />
          <div>
            <h1 class="text-lg font-semibold leading-tight text-primary">Telescope</h1>
            <p class="text-xs text-secondary">Zoom into your graph</p>
          </div>
        </div>
        <button class="segmented-pill inline-flex items-center gap-1.5 px-3 py-1 text-xs" @click="openAbout">
          <Info :size="13" /><span>About</span>
        </button>
      </div>

      <hr class="mb-6 border-slate-200" />

      <!-- Upload -->
      <div class="mb-6">
        <button
          v-if="!pickedFile"
          class="flex w-full items-center gap-3 rounded-lg px-4 py-3 ring-1 text-left transition disabled:opacity-50"
          :class="dragOver ? 'ring-slate-400 bg-white' : 'surface-recessed ring-transparent hover:bg-white hover:ring-slate-200'"
          :disabled="loading"
          @click="fileInput?.click()"
        >
          <Upload :size="16" class="shrink-0 text-secondary" />
          <span class="flex flex-col">
            <span class="text-sm font-semibold text-primary">Upload your own file</span>
            <span class="text-xs text-muted">NetworkX node-link JSON · or drop anywhere</span>
          </span>
        </button>

        <div v-else class="space-y-2">
          <div class="flex items-center justify-between rounded-lg surface-recessed px-3 py-2.5">
            <div class="flex min-w-0 items-center gap-2">
              <FileJson :size="15" class="shrink-0 text-primary" />
              <div class="flex min-w-0 flex-col leading-tight">
                <span class="truncate text-sm font-medium text-primary">{{ pickedFile.name }}</span>
                <span class="text-xs text-muted">{{ fmtSize(pickedFile.size) }}</span>
              </div>
            </div>
            <button class="shrink-0 text-muted hover:text-red-500" @click="clearFile"><X :size="14" /></button>
          </div>
          <input
            v-model="graphName"
            type="text"
            placeholder="Graph name (optional)"
            maxlength="80"
            class="input-base w-full px-3 py-2 text-sm text-primary placeholder:text-muted"
          />
        </div>

        <input ref="fileInput" type="file" accept=".json" class="hidden" @change="onPick" />
      </div>

      <!-- Divider -->
      <div class="relative mb-6">
        <hr class="border-slate-200" />
        <span class="absolute left-1/2 top-1/2 -translate-x-1/2 -translate-y-1/2 bg-white px-2 text-xs text-muted">or</span>
      </div>

      <!-- Sample datasets: 2-column list, segmented-pill selection vocabulary -->
      <div class="mb-6 grid grid-cols-2 gap-2">
        <button
          v-for="ds in builtins"
          :key="ds.name"
          class="flex h-full items-start gap-3 rounded-lg px-3 py-3 text-left ring-1 transition disabled:opacity-50"
          :class="selectedBuiltin === ds.name
            ? 'elev-light ring-slate-300 shadow-sm'
            : 'surface-recessed ring-transparent hover:bg-white hover:ring-slate-200'"
          :disabled="loading"
          @click="selectBuiltin(ds.name)"
        >
          <span class="flex min-w-0 flex-col gap-1.5">
            <span class="text-sm font-semibold leading-tight text-primary">{{ ds.description }}</span>
            <!-- Stats -->
            <span v-if="ds.nodes != null" class="text-xs font-medium text-primary">
              {{ ds.nodes.toLocaleString() }} nodes<template v-if="ds.node_types > 1"> ({{ ds.node_types }} types)</template>
              · {{ ds.edges.toLocaleString() }} edges<template v-if="ds.edge_types > 1"> ({{ ds.edge_types }} types)</template>
            </span>
            <!-- Chips -->
            <span v-if="ds.nodes != null" class="flex flex-wrap gap-1">
              <span class="rounded-full bg-white px-1.5 py-px text-[10px] font-medium text-slate-500 ring-1 ring-slate-200">{{ ds.directed ? 'directed' : 'undirected' }}</span>
              <span v-if="ds.weighted" class="rounded-full bg-white px-1.5 py-px text-[10px] font-medium text-slate-500 ring-1 ring-slate-200">weighted</span>
              <span v-if="ds.bipartite" class="rounded-full bg-white px-1.5 py-px text-[10px] font-medium text-slate-500 ring-1 ring-slate-200">bipartite</span>
              <span v-if="ds.multigraph" class="rounded-full bg-white px-1.5 py-px text-[10px] font-medium text-slate-500 ring-1 ring-slate-200">multigraph</span>
            </span>
            <!-- Description -->
            <span class="text-xs italic text-secondary text-justify leading-relaxed">"{{ DATASET_META[ds.name]?.blurb }}"</span>
          </span>
        </button>
      </div>

      <p v-if="error" class="mb-4 text-sm text-red-500">{{ error }}</p>

      <button
        class="w-full inline-flex items-center justify-center gap-1.5 rounded-lg bg-slate-900 px-4 py-2.5 text-sm font-medium text-white transition hover:bg-slate-800 disabled:cursor-not-allowed disabled:opacity-40 disabled:hover:bg-slate-900"
        :disabled="!canLoad"
        @click="onLoad"
      >
        <span>{{ loading ? 'Loading…' : 'Load graph' }}</span>
        <ArrowRight v-if="!loading" :size="14" />
      </button>
    </div>

    <div
      v-if="dragOver"
      class="pointer-events-none fixed inset-0 z-30 flex items-center justify-center bg-slate-900/10 backdrop-blur-[1px]"
    >
      <div class="card-elev rounded-lg px-5 py-3">
        <p class="inline-flex items-center gap-2 text-sm font-medium text-primary">
          <Upload :size="16" /><span>Drop to upload</span>
        </p>
      </div>
    </div>
  </main>
</template>
