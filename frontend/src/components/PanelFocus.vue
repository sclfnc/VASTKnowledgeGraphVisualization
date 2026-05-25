<script setup>
// EXTENSION: focus modal — chart on the left, theory drawer on the right.
// Closes on ✕, on backdrop click, and on Escape.
import { onMounted, onUnmounted, computed } from 'vue'
import { X } from 'lucide-vue-next'

const props = defineProps({
  panel: { type: Object, default: null },
  schema: { type: Object, required: true },
  graphId: { type: String, required: true },
})
const emit = defineEmits(['close'])

const explanation = computed(() => {
  if (!props.panel) return ''
  const contextualize = props.panel.contextualizeExplanation
  if (contextualize && typeof contextualize === 'function') {
    return contextualize(props.schema, {})
  }
  return props.panel.explanation || 'Explanation coming soon.'
})

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
      <div class="relative flex w-full max-w-6xl max-h-[90vh] rounded-2xl bg-white shadow-xl overflow-hidden">
        <div class="flex-1 p-10 overflow-y-auto">
          <div class="mb-6 flex items-center justify-between">
            <span class="text-lg font-semibold text-primary">{{ panel.label }}</span>
            <button class="text-muted hover:text-primary" @click="emit('close')"><X :size="18" /></button>
          </div>
          <component
            :is="panel.component"
            v-bind="panel.componentProps || {}"
            :panel-spec="panel"
            :schema="schema"
            :graph-id="graphId"
          />
        </div>
        <div class="w-96 shrink-0 overflow-y-auto border-l border-slate-200 p-10 text-sm leading-relaxed text-secondary">
          <p class="mb-3 text-xs font-semibold uppercase tracking-widest text-muted">Theory</p>
          {{ explanation }}
        </div>
      </div>
    </div>
  </Teleport>
</template>
