<script setup>
// EXTENSION: focus modal — chart on the left, theory drawer on the right.
// Closes on ✕, on backdrop click, and on Escape.
//
// Theory has two tiers: a panel may Teleport a rich, interactive theory block
// into `#theoryTarget` (it gets `controls` + live data, so inline links can
// drive the chart). If it doesn't, we fall back to the static
// `contextualizeExplanation(schema, null)` / `explanation` string.
import { onMounted, onUnmounted, computed, ref, nextTick, watch } from 'vue'
import { X } from 'lucide-vue-next'

const props = defineProps({
  panel: { type: Object, default: null },
  schema: { type: Object, default: null },
  graphId: { type: String, default: null },
})
const emit = defineEmits(['close'])

const theoryTarget = 'panel-focus-theory'
const theoryReady = ref(false)
// Tracks whether the mounted panel actually filled the teleport target, so we
// only hide the static fallback when a rich block is present. The panel mounts
// + fetches async, so the teleport can land after our first check — a
// MutationObserver keeps the flag in sync as children appear/disappear.
const hasRichTheory = ref(false)
let observer = null

function watchTeleport() {
  const el = document.getElementById(theoryTarget)
  if (!el) return
  const sync = () => { hasRichTheory.value = el.childElementCount > 0 }
  sync()
  observer?.disconnect()
  observer = new MutationObserver(sync)
  observer.observe(el, { childList: true })
}

watch(() => props.panel, async (p) => {
  theoryReady.value = false
  hasRichTheory.value = false
  observer?.disconnect()
  if (!p) return
  await nextTick()
  theoryReady.value = true
  await nextTick()
  watchTeleport()
}, { immediate: true })

const explanation = computed(() => {
  if (!props.panel) return ''
  const contextualize = props.panel.contextualizeExplanation
  if (contextualize && typeof contextualize === 'function') {
    const contextual = contextualize(props.schema, null)
    if (contextual) return contextual
  }
  return props.panel.explanation || 'Explanation coming soon.'
})

const onKeydown = (e) => { if (e.key === 'Escape') emit('close') }
onMounted(() => window.addEventListener('keydown', onKeydown))
onUnmounted(() => {
  window.removeEventListener('keydown', onKeydown)
  observer?.disconnect()
})
</script>

<template>
  <Teleport to="body">
    <div
      v-if="panel"
      class="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/60 backdrop-blur-sm"
      @click.self="emit('close')"
    >
      <div class="relative flex w-full max-w-7xl max-h-[90vh] rounded-2xl bg-white shadow-xl overflow-hidden">
        <div class="flex flex-1 flex-col p-10 min-h-0">
          <div class="mb-6 flex items-center justify-between">
            <span class="text-lg font-semibold text-primary">{{ panel.label }}</span>
            <button class="text-muted hover:text-primary" @click="emit('close')"><X :size="18" /></button>
          </div>
          <!-- Chart fills the remaining height instead of imposing its 4/3
               aspect-ratio (which overflowed and triggered a scrollbar). The
               panel reads clientWidth/Height, so a bounded box just works. -->
          <div class="panel-focus-chart min-h-0 flex-1 overflow-hidden">
            <component
              :is="panel.component"
              v-bind="panel.componentProps || {}"
              :panel-spec="panel"
              :schema="schema"
              :graph-id="graphId"
              :theory-target="theoryReady ? theoryTarget : null"
            />
          </div>
        </div>
        <div class="w-[30rem] shrink-0 overflow-y-auto border-l border-slate-200 p-10 text-sm leading-relaxed text-secondary">
          <div :id="theoryTarget" />
          <p v-if="!hasRichTheory" class="whitespace-pre-line">{{ explanation }}</p>
        </div>
      </div>
    </div>
  </Teleport>
</template>

<style scoped>
/* Make the mounted panel fill the bounded chart box vertically. The panel's
   root is a flex-column; we let it grow and relax the chart container's fixed
   4/3 aspect-ratio so it shrinks to fit instead of overflowing the modal. */
.panel-focus-chart > :deep(*) {
  height: 100%;
  display: flex;
  flex-direction: column;
}
.panel-focus-chart :deep(.chart-elev) {
  aspect-ratio: auto !important;
  flex: 1 1 auto;
  min-height: 0;
}
</style>
