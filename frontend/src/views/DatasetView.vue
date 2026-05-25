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
    <div class="card-elev w-full max-w-xl rounded-2xl p-7">
      <!-- Branding header inside the card: logo + tagline left, About right.
           The whole onboarding lives in this one block — no detached chrome. -->
      <div class="mb-5 flex items-start justify-between gap-4">
        <div class="flex items-center gap-3">
          <Telescope :size="34" class="text-primary shrink-0" :stroke-width="1.75" />
          <div class="min-w-0">
            <h1 class="text-lg font-semibold leading-tight text-primary">Telescope</h1>
            <p class="text-xs text-secondary">Zoom into your graph</p>
          </div>
        </div>
        <button
          class="segmented-pill inline-flex items-center gap-1.5 px-3 py-1 text-xs"
          @click="openAbout"
        >
          <Info :size="13" />
          <span>About</span>
        </button>
      </div>

      <hr class="mb-5 border-slate-200" />

      <!-- Orientation copy: tells the user what this screen is for in one sentence. -->
      <p class="mb-4 text-sm text-secondary">
        To start exploring, pick a graph below — one of the
        <span class="font-medium text-primary">built-in datasets</span> or
        <span class="font-medium text-primary">your own</span> JSON file — then click
        <span class="font-medium text-primary">Load graph</span>.
      </p>

      <ul class="flex flex-col gap-2">
        <li v-for="ds in builtins" :key="ds.name">
          <button
            class="flex w-full flex-col gap-1 rounded-lg px-4 py-3 text-left ring-1 transition disabled:opacity-50"
            :class="selectedBuiltin === ds.name
              ? 'elev-light ring-slate-300 shadow-sm'
              : 'surface-recessed ring-transparent hover:bg-white hover:ring-slate-200'"
            :disabled="loading"
            @click="selectBuiltin(ds.name)"
          >
            <span class="text-sm font-semibold text-primary">{{ ds.description }}</span>
            <span v-if="ds.nodes != null" class="flex flex-wrap items-center gap-x-1.5 gap-y-0.5 text-[11px] text-secondary">
              <span>
                <span class="font-medium text-primary">{{ ds.nodes.toLocaleString() }}</span> nodes<template v-if="ds.node_types > 1"> ({{ ds.node_types }} types)</template>
              </span>
              <span class="text-muted">·</span>
              <span>
                <span class="font-medium text-primary">{{ ds.edges.toLocaleString() }}</span> edges<template v-if="ds.edge_types > 1"> ({{ ds.edge_types }} types)</template>
              </span>
              <span class="text-muted">·</span>
              <span>{{ ds.directed ? 'directed' : 'undirected' }}</span>
              <template v-if="ds.weighted">
                <span class="text-muted">·</span>
                <span>weighted</span>
              </template>
              <template v-if="ds.bipartite">
                <span class="text-muted">·</span>
                <span>bipartite</span>
              </template>
              <template v-if="ds.multigraph">
                <span class="text-muted">·</span>
                <span>multigraph</span>
              </template>
            </span>
          </button>
        </li>

        <li>
          <!-- Upload tile: same vocabulary as built-in tiles. When a file is picked,
               selection visuals match the built-in selected state. -->
          <div
            class="flex flex-col gap-2 rounded-lg px-4 py-3 ring-1 transition"
            :class="pickedFile
              ? 'elev-light ring-slate-300 shadow-sm'
              : dragOver
                ? 'elev-light ring-slate-300'
                : 'surface-recessed ring-transparent hover:bg-white hover:ring-slate-200'"
          >
            <button
              v-if="!pickedFile"
              class="flex w-full items-center justify-between gap-3 text-left disabled:opacity-50"
              :disabled="loading"
              @click="fileInput?.click()"
            >
              <span class="flex flex-col gap-0.5">
                <span class="inline-flex items-center gap-1.5 text-sm font-semibold text-primary">
                  <Upload :size="14" />
                  <span>Upload your own JSON file</span>
                </span>
                <span class="text-[11px] text-muted">NetworkX node-link format · or drop a file anywhere on this page</span>
              </span>
            </button>

            <div v-else class="space-y-2">
              <div class="flex items-center justify-between rounded-md surface-recessed px-3 py-2">
                <div class="flex min-w-0 items-center gap-2">
                  <FileJson :size="16" class="shrink-0 text-primary" />
                  <div class="flex min-w-0 flex-col leading-tight">
                    <span class="truncate text-sm font-medium text-primary">{{ pickedFile.name }}</span>
                    <span class="text-[11px] text-muted">{{ fmtSize(pickedFile.size) }}</span>
                  </div>
                </div>
                <button
                  class="shrink-0 text-muted hover:text-red-500"
                  title="Remove file"
                  @click="clearFile"
                ><X :size="14" /></button>
              </div>

              <div class="flex flex-col gap-1">
                <label class="text-[11px] font-medium text-secondary">Graph name <span class="text-muted">(optional)</span></label>
                <input
                  v-model="graphName"
                  type="text"
                  placeholder="Uploaded graph"
                  maxlength="80"
                  class="input-base px-2.5 py-1.5 text-sm text-primary placeholder:text-muted"
                />
              </div>
            </div>

            <input
              ref="fileInput"
              type="file"
              accept=".json"
              class="hidden"
              @change="onPick"
            />
          </div>
        </li>
      </ul>

      <p v-if="error" class="mt-4 text-sm text-red-500">{{ error }}</p>

      <div class="mt-5 flex items-center justify-end">
        <button
          class="inline-flex items-center gap-1.5 rounded-full bg-slate-900 px-4 py-1.5 text-sm font-medium text-white transition hover:bg-slate-800 disabled:cursor-not-allowed disabled:opacity-40 disabled:hover:bg-slate-900"
          :disabled="!canLoad"
          @click="onLoad"
        >
          <span>{{ loading ? 'Loading…' : 'Load graph' }}</span>
          <ArrowRight v-if="!loading" :size="13" />
        </button>
      </div>
    </div>

    <!-- Full-page drop overlay: instant visual confirmation when a file is over the page. -->
    <div
      v-if="dragOver"
      class="pointer-events-none fixed inset-0 z-30 flex items-center justify-center bg-slate-900/10 backdrop-blur-[1px]"
    >
      <div class="card-elev rounded-lg px-5 py-3 shadow-sm ring-1 ring-slate-200">
        <p class="inline-flex items-center gap-2 text-sm font-medium text-primary">
          <Upload :size="16" />
          <span>Drop to upload</span>
        </p>
      </div>
    </div>
  </main>
</template>
