<script setup>
// EXTENSION: onboarding view — pick a built-in dataset or upload a file
import { ref, onMounted } from 'vue'
import { useRouter } from 'vue-router'
import { Upload, Database, ArrowRight } from 'lucide-vue-next'
import { useDatasetLoader, fetchDatasets } from '../composables/useDatasetLoader.js'

const router = useRouter()
const { loading, error, loadBuiltin, uploadFile } = useDatasetLoader()

const builtins = ref([])
const selected = ref(null)

onMounted(async () => { builtins.value = await fetchDatasets() })

async function onContinue() {
  if (!selected.value) return
  const data = await loadBuiltin(selected.value)
  if (data) router.push({ name: 'home' })
}

async function onUpload(e) {
  const file = e.target.files[0]
  if (!file) return
  const data = await uploadFile(file)
  if (data) router.push({ name: 'home' })
}
</script>

<template>
  <main class="flex min-h-screen items-center justify-center bg-gray-50">
    <div class="w-full max-w-2xl rounded-xl border border-gray-200 bg-white p-8 shadow-sm">
      <h1 class="mb-6 text-xl font-semibold text-gray-800">Load a graph</h1>

      <div class="grid grid-cols-2 gap-6">
        <div class="rounded-lg border border-dashed border-gray-300 p-6">
          <p class="mb-3 flex items-center gap-1.5 text-sm font-medium text-gray-700">
            <Upload :size="14" />
            <span>Upload file</span>
          </p>
          <p class="mb-4 text-xs text-gray-400">.json (NetworkX node-link format)</p>
          <input type="file" accept=".json" class="text-sm text-gray-600" @change="onUpload" />
        </div>

        <div class="rounded-lg border border-gray-200 p-6">
          <p class="mb-3 flex items-center gap-1.5 text-sm font-medium text-gray-700">
            <Database :size="14" />
            <span>Built-in datasets</span>
          </p>
          <ul class="space-y-2">
            <li v-for="ds in builtins" :key="ds.name">
              <label class="flex cursor-pointer items-start gap-2 text-sm text-gray-700">
                <input type="radio" :value="ds.name" v-model="selected" class="mt-0.5" />
                <span>
                  <span class="font-medium">{{ ds.name }}</span>
                  <span class="ml-1 text-xs text-gray-400">{{ ds.description }}</span>
                </span>
              </label>
            </li>
          </ul>
        </div>
      </div>

      <p v-if="error" class="mt-4 text-sm text-red-500">{{ error }}</p>

      <div class="mt-6 flex justify-end">
        <button
          :disabled="!selected || loading"
          class="flex items-center gap-1.5 rounded-md bg-gray-900 px-5 py-2 text-sm text-white disabled:opacity-40"
          @click="onContinue"
        >
          <span>{{ loading ? 'Loading...' : 'Continue' }}</span>
          <ArrowRight v-if="!loading" :size="14" />
        </button>
      </div>
    </div>
  </main>
</template>
