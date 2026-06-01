<script setup>
// EXTENSION: focus modal — chart on the left, theory drawer on the right.
// Closes on ✕, on backdrop click, and on Escape.
//
// The mounted panel Teleports its interactive theory block into `#theoryTarget`
// (it receives `controls` + live data, so inline links can drive the chart).
import { onMounted, onUnmounted, ref, nextTick, watch } from 'vue'
import { X } from 'lucide-vue-next'

const props = defineProps({
  panel: { type: Object, default: null },
  schema: { type: Object, default: null },
  graphId: { type: String, default: null },
})
const emit = defineEmits(['close'])

const theoryTarget = 'panel-focus-theory'
const theoryReady = ref(false)

// The teleport target must exist before the panel mounts into it, so flip
// `theoryReady` one tick after the panel changes.
watch(() => props.panel, async (p) => {
  theoryReady.value = false
  if (!p) return
  await nextTick()
  theoryReady.value = true
}, { immediate: true })

const onKeydown = (e) => { if (e.key === 'Escape') emit('close') }
onMounted(() => window.addEventListener('keydown', onKeydown))
onUnmounted(() => window.removeEventListener('keydown', onKeydown))
</script>

<template>
  <Teleport to="body">
    <div
      v-if="panel"
      class="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/60 backdrop-blur-sm"
      @click.self="emit('close')"
    >
      <div class="relative flex w-full max-w-7xl h-[85vh] max-h-[90vh] rounded-2xl bg-white shadow-xl overflow-hidden">
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
