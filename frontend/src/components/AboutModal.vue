<script setup>
// EXTENSION: about modal — branding, project context, stack, author, progress.
import { onMounted, onUnmounted } from 'vue'
import { Telescope, X, Github } from 'lucide-vue-next'

defineProps({ open: { type: Boolean, default: false } })
const emit = defineEmits(['close'])

const onKeydown = (e) => { if (e.key === 'Escape') emit('close') }
onMounted(() => window.addEventListener('keydown', onKeydown))
onUnmounted(() => window.removeEventListener('keydown', onKeydown))
</script>

<template>
  <Teleport to="body">
    <div
      v-if="open"
      class="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/30 backdrop-blur-[2px]"
      @click.self="emit('close')"
    >
      <div class="card-elev relative max-h-[90vh] w-full max-w-xl overflow-y-auto rounded-2xl p-8">
        <button
          class="absolute right-4 top-4 text-muted hover:text-primary"
          @click="emit('close')"
        ><X :size="18" /></button>

        <div class="flex items-center gap-5">
          <Telescope :size="44" class="text-primary" :stroke-width="1.75" />
          <div class="min-w-0 flex-1">
            <h2 class="text-2xl font-semibold leading-tight text-primary">Telescope</h2>
            <p class="text-sm text-secondary">Zoom into your graph</p>
            <div class="mt-1.5 flex flex-wrap gap-x-4 gap-y-1 text-xs">
              <a
                href="https://github.com/sclfnc"
                target="_blank"
                rel="noopener noreferrer"
                class="inline-flex items-center gap-1.5 font-medium text-primary underline decoration-slate-300 underline-offset-2 hover:decoration-slate-900"
              ><Github :size="13" /> Francesco Secoli</a>
              <a
                href="https://github.com/sclfnc/VASTKnowledgeGraphVisualization/tree/api-integration"
                target="_blank"
                rel="noopener noreferrer"
                class="inline-flex items-center gap-1.5 font-medium text-primary underline decoration-slate-300 underline-offset-2 hover:decoration-slate-900"
              ><Github :size="13" /> Repository <span class="font-normal text-muted">· api-integration</span></a>
            </div>
          </div>
        </div>

        <hr class="my-5 border-slate-200" />

        <div class="space-y-2 text-sm leading-relaxed text-secondary">
          <p>
            A visual analytics prototype for exploring knowledge graphs through coordinated D3
            panels. Academic project.
          </p>

          <p>
            <span class="font-medium text-primary">Panels.</span> Degree distribution,
            connected components, four centrality measures (PageRank, Eigenvector,
            Betweenness, Closeness) plus a comparison matrix, ego network and multi-ego
            comparison, type-mixing matrix, edge-type flow, node and edge attribute schema,
            activity timeline.
          </p>

          <p>
            <span class="font-medium text-primary">Coordination.</span> Filters and
            selections propagate across panels via mask-only semantics (marks attenuate,
            metrics stay anchored to the full graph).
          </p>

          <p>
            <span class="font-medium text-primary">Per-panel affordances.</span> Pin restricts
            a panel to the current selection; Lock freezes a snapshot independently of live
            mutations.
          </p>
        </div>

        <hr class="my-5 border-slate-200" />

        <div class="space-y-4">
          <div>
            <p class="mb-1.5 text-[11px] font-medium uppercase tracking-wider text-muted">Frontend stack</p>
            <dl class="space-y-1.5 text-sm">
              <div>
                <dt class="font-medium text-primary">D3</dt>
              </div>
              <div>
                <dt class="font-medium text-primary">Vue 3</dt>
                <dd class="text-xs text-muted">@vueform/slider · Lucide · Pinia · Tailwind · Vite · Vue Router</dd>
              </div>
            </dl>
          </div>

          <div>
            <p class="mb-1.5 text-[11px] font-medium uppercase tracking-wider text-muted">Backend stack</p>
            <dl class="space-y-1.5 text-sm">
              <div>
                <dt class="font-medium text-primary">FastAPI</dt>
                <dd class="text-xs text-muted">Uvicorn</dd>
              </div>
              <div>
                <dt class="font-medium text-primary">NetworkX</dt>
              </div>
              <div>
                <dt class="font-medium text-primary">NetworKit</dt>
              </div>
              <div>
                <dt class="font-medium text-primary">powerlaw</dt>
                <dd class="text-xs text-muted">SciPy</dd>
              </div>
            </dl>
          </div>
        </div>

        <hr class="my-5 border-slate-200" />

        <div>
          <p class="mb-1.5 text-[11px] font-medium uppercase tracking-wider text-muted">Next steps</p>
          <ol class="list-decimal space-y-1.5 pl-5 text-sm text-secondary">
            <li>Panel-by-panel HCI audit, including cross-panel relationships.</li>
            <li>Visual-Analytics-specific layout pass: at least two alternative encodings per panel
              where meaningful — one for data scientists, one for non-experts.</li>
          </ol>
        </div>

        <hr class="my-5 border-slate-200" />

        <div class="flex items-center justify-between">
          <p class="text-xs italic text-muted">Work in progress — prototype.</p>
          <p class="text-xs text-muted">v0.5.5 · 2026-05-25</p>
        </div>
      </div>
    </div>
  </Teleport>
</template>
