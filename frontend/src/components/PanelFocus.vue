<script setup>
// EXTENSION: focus modal — chart on the left, theory drawer on the right.
// Closes on ✕, on backdrop click, and on Escape.
import { onMounted, onUnmounted } from 'vue'
import { X } from 'lucide-vue-next'

const props = defineProps({ panel: { type: Object, default: null } })
const emit = defineEmits(['close'])

const onKeydown = (e) => { if (e.key === 'Escape') emit('close') }
onMounted(() => window.addEventListener('keydown', onKeydown))
onUnmounted(() => window.removeEventListener('keydown', onKeydown))
</script>

<template>
  <Teleport to="body">
    <div
      v-if="panel"
      class="fixed inset-0 z-40 flex items-center justify-center bg-black/40"
      @click.self="emit('close')"
    >
      <div class="relative flex w-full max-w-4xl rounded-xl bg-white shadow-xl">
        <div class="flex-1 p-10">
          <div class="mb-6 flex items-center justify-between">
            <span class="text-lg font-semibold text-slate-800">{{ panel.label }}</span>
            <button class="text-slate-400 hover:text-slate-700" @click="emit('close')"><X :size="18" /></button>
          </div>
          <div class="flex h-80 items-center justify-center rounded bg-slate-50 text-sm text-slate-400">
            chart placeholder — {{ panel.label }}
          </div>
        </div>
        <div class="w-96 shrink-0 overflow-y-auto border-l border-slate-100 p-10 text-sm leading-relaxed text-slate-600">
          <p class="mb-3 text-xs font-semibold uppercase tracking-widest text-slate-400">Theory</p>
          {{ panel.explanation || 'Explanation coming soon.' }}
        </div>
      </div>
    </div>
  </Teleport>
</template>
