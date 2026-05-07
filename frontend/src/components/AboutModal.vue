<script setup>
// EXTENSION: about modal — branding, project context, stack, author, progress.
import { onMounted, onUnmounted } from 'vue'
import { Telescope, X, Github } from 'lucide-vue-next'

const props = defineProps({ open: { type: Boolean, default: false } })
const emit = defineEmits(['close'])

const onKeydown = (e) => { if (e.key === 'Escape') emit('close') }
onMounted(() => window.addEventListener('keydown', onKeydown))
onUnmounted(() => window.removeEventListener('keydown', onKeydown))
</script>

<template>
  <Teleport to="body">
    <div
      v-if="open"
      class="fixed inset-0 z-40 flex items-center justify-center bg-black/40"
      @click.self="emit('close')"
    >
      <div class="relative max-h-[90vh] w-full max-w-lg overflow-y-auto rounded-xl bg-white p-8 shadow-xl">
        <button
          class="absolute right-4 top-4 text-slate-400 hover:text-slate-700"
          @click="emit('close')"
        ><X :size="18" /></button>

        <div class="mb-5 flex items-center gap-2.5">
          <Telescope :size="32" class="text-slate-800" :stroke-width="1.75" />
          <div>
            <h2 class="text-xl font-semibold leading-tight text-slate-900">Telescope</h2>
            <p class="text-xs text-slate-500">Zoom into your graph</p>
          </div>
        </div>

        <p class="mb-3 text-sm leading-relaxed text-slate-600">
          A visual analytics prototype for non-expert exploration of knowledge graphs — built
          around discovery, anomaly detection, and missing-data inference.
        </p>

        <p class="mb-6 text-sm leading-relaxed text-slate-600">
          Developed for an academic project on visual analytics for knowledge graphs.
        </p>

        <div class="mb-5">
          <p class="mb-2 text-xs font-semibold uppercase tracking-widest text-slate-400">Stack</p>
          <ul class="space-y-1 text-sm text-slate-600">
            <li><span class="text-slate-400">Frontend:</span> Vue 3 · Vite · Pinia · Tailwind CSS · D3 <span class="text-slate-400">(still missing)</span></li>
            <li><span class="text-slate-400">Backend:</span> FastAPI · NetworkX</li>
            <li><span class="text-slate-400">Analysis:</span> NetworkX · NetworKit · pandas · Jupyter</li>
          </ul>
        </div>

        <div class="mb-5">
          <p class="mb-2 text-xs font-semibold uppercase tracking-widest text-slate-400">Author</p>
          <a
            href="https://github.com/sclfnc"
            target="_blank"
            rel="noopener noreferrer"
            class="inline-flex items-center gap-1.5 text-sm text-slate-700 hover:text-slate-900"
          >
            <Github :size="14" />
            <span>Francesco Secoli — github.com/sclfnc</span>
          </a>
        </div>

        <div class="mb-5">
          <p class="mb-2 text-xs font-semibold uppercase tracking-widest text-slate-400">Repository</p>
          <a
            href="https://github.com/sclfnc/VASTKnowledgeGraphVisualization/tree/api-integration"
            target="_blank"
            rel="noopener noreferrer"
            class="inline-flex items-center gap-1.5 text-sm text-slate-700 hover:text-slate-900"
          >
            <Github :size="14" />
            <span>sclfnc/VASTKnowledgeGraphVisualization <span class="text-slate-400">· api-integration</span></span>
          </a>
        </div>

        <div class="mb-5">
          <p class="mb-2 text-xs font-semibold uppercase tracking-widest text-slate-400">Progress so far</p>
          <p class="text-sm leading-relaxed text-slate-600">
            Onboarding flow with built-in datasets and JSON upload, schema inspection,
            dynamic filters (types, degree, weight, attributes), didactic Guide view with
            a panel registry, focus modal with theory drawer.
          </p>
        </div>

        <div class="mb-5">
          <p class="mb-2 text-xs font-semibold uppercase tracking-widest text-slate-400">Coming next</p>
          <p class="mb-2 text-sm leading-relaxed text-slate-600">
            The next iterations focus on the <span class="font-medium text-slate-700">Guide view</span> — turning its
            sections from labelled placeholders into a connected didactic surface.
          </p>
          <ul class="space-y-1.5 text-sm text-slate-600">
            <li><span class="font-medium text-slate-700">Real chart panels</span> — replace placeholders with D3 charts driven by the loaded graph (degree distribution, centrality comparisons, k-core, etc.)</li>
            <li><span class="font-medium text-slate-700">Cross-panel links</span> — each panel references related concepts in other sections; clicking a term opens the linked panel and scrolls it into focus</li>
            <li><span class="font-medium text-slate-700">Theory drawer with examples</span> — every panel's theory text annotated with live snippets from the current graph, not generic prose</li>
            <li><span class="font-medium text-slate-700">Schema-aware conditional panels</span> — <span class="italic">Reciprocity</span> only when directed, <span class="italic">Edge Weight</span> only when weighted, <span class="italic">Cross-type Matrix</span> only when heterogeneous, etc.</li>
          </ul>
        </div>

        <div class="mb-5">
          <p class="mb-2 text-xs font-semibold uppercase tracking-widest text-slate-400">Desiderata</p>
          <p class="text-sm leading-relaxed text-slate-600">
            A <span class="font-medium text-slate-700">didactic graph view</span>: a small live subgraph extracted from
            the loaded dataset that visually demonstrates each concept as you read about it
            (highlight a hub for <span class="italic">degree centrality</span>, colour a triangle for
            <span class="italic">triadic closure</span>, etc.). Same graph, different lenses — the wiki teaches graph
            theory <span class="italic">through</span> the user's own data instead of with toy examples.
          </p>
        </div>

        <div class="flex items-center justify-between">
          <p class="text-xs italic text-slate-400">Work in progress — prototype.</p>
          <p class="text-xs text-slate-400">v0.3.0 · 2026-05-07</p>
        </div>
      </div>
    </div>
  </Teleport>
</template>
