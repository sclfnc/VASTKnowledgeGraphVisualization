<script setup>
// Dataset switcher dropdown. Owns dataset list fetch, dropdown state,
// click-outside listener, switch flow. Works in light and dark scopes via
// the `darkScope` prop. Reusable in App header and Guide sidebar.
import { RouterLink } from 'vue-router'
import { ref, onMounted, onUnmounted } from 'vue'
import { Database, ChevronDown, Upload } from 'lucide-vue-next'
import { useGraphStore } from '../stores/graph.js'
import { useDatasetLoader, fetchDatasets } from '../composables/useDatasetLoader.js'

defineProps({
  darkScope: { type: Boolean, default: false },
  fullWidth: { type: Boolean, default: false },
})

const graphStore = useGraphStore()
const { loadBuiltin } = useDatasetLoader()

const datasets = ref([])
const open = ref(false)

const onClickOutside = (e) => {
  if (!e.target.closest('.dataset-dropdown')) open.value = false
}

onMounted(async () => {
  datasets.value = await fetchDatasets()
  document.addEventListener('click', onClickOutside)
})

onUnmounted(() => document.removeEventListener('click', onClickOutside))

async function switchDataset(name) {
  if (!confirm('Changing dataset will reset the current view. Continue?')) return
  open.value = false
  await loadBuiltin(name)
}
</script>

<template>
  <div
    class="dataset-dropdown relative inline-flex items-center segmented-track"
    :class="[darkScope ? 'segmented-track--dark' : '', fullWidth ? 'w-full' : '']"
  >
    <button
      class="segmented-pill inline-flex items-center justify-center gap-1.5 px-3 py-0.5 text-sm"
      :class="[
        { 'segmented-pill--active': open },
        fullWidth ? 'w-full justify-between' : 'min-w-[6.5rem]',
      ]"
      @click="open = !open"
    >
      <span class="inline-flex items-center gap-1.5">
        <Database :size="14" />
        <span>Dataset</span>
      </span>
      <ChevronDown :size="14" :class="open ? 'rotate-180 transition' : 'transition'" />
    </button>
    <div
      v-if="open"
      class="absolute z-20 w-48 rounded-lg border shadow-md"
      :class="darkScope
        ? 'left-0 bottom-full mb-1 surface-dark-raised border-dark'
        : 'right-0 top-full mt-1 elev-light border-slate-200'"
    >
      <button
        v-for="ds in datasets"
        :key="ds.name"
        class="block w-full px-4 py-2 text-left text-sm"
        :class="darkScope
          ? (graphStore.graphId === `builtin_${ds.name}`
              ? 'font-semibold text-on-dark-primary hover:surface-dark-recessed'
              : 'text-on-dark-secondary hover:text-on-dark-primary hover:surface-dark-recessed')
          : (graphStore.graphId === `builtin_${ds.name}`
              ? 'font-semibold text-primary hover:surface-recessed'
              : 'text-secondary hover:surface-recessed')"
        @click="switchDataset(ds.name)"
      >{{ ds.name }}</button>
      <div class="border-t" :class="darkScope ? 'border-dark' : 'border-slate-200'">
        <RouterLink
          to="/dataset"
          class="flex items-center gap-1.5 px-4 py-2 text-sm"
          :class="darkScope
            ? 'text-on-dark-muted hover:text-on-dark-primary hover:surface-dark-recessed'
            : 'text-muted hover:surface-recessed'"
          @click="open = false"
        >
          <Upload :size="14" />
          <span>Upload file…</span>
        </RouterLink>
      </div>
    </div>
  </div>
</template>
