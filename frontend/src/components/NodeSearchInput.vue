<script setup>
// Search input + suggestions dropdown over the in-memory node index.
// Substring filter on `id`, top 5 by degree (input list is pre-sorted desc
// server-side). Emits `pick(id)` on click or Enter; the parent decides what
// to do with the picked id.
import { ref, computed } from 'vue'
import { Search } from 'lucide-vue-next'

const props = defineProps({
  nodes:       { type: Array, default: () => [] },
  exclude:     { type: Array, default: () => [] },
  placeholder: { type: String, default: 'Search node by id…' },
  disabled:    { type: Boolean, default: false },
})

const emit = defineEmits(['pick'])

const query = ref('')
const open = ref(false)

const suggestions = computed(() => {
  const q = query.value.trim().toLowerCase()
  if (!q) return []
  const excl = new Set(props.exclude.map(String))
  return (props.nodes || [])
    .filter(n => !excl.has(String(n.id)) && String(n.id).toLowerCase().includes(q))
    .slice(0, 5)
})

function pick(id) {
  emit('pick', String(id))
  query.value = ''
  open.value = false
}

function onEnter() {
  if (suggestions.value.length) pick(suggestions.value[0].id)
}
</script>

<template>
  <div class="relative">
    <div class="flex items-center gap-1.5 input-base px-2 py-1 text-[11px]">
      <Search :size="12" class="text-muted shrink-0" />
      <input
        v-model="query"
        type="text"
        :placeholder="placeholder"
        :disabled="disabled"
        class="flex-1 bg-transparent outline-none"
        @focus="open = true"
        @blur="setTimeout(() => open = false, 150)"
        @keydown.enter.prevent="onEnter"
      />
    </div>
    <ul
      v-if="open && suggestions.length"
      class="absolute z-10 mt-1 w-full rounded-md border border-slate-200 bg-white shadow-sm"
    >
      <li
        v-for="s in suggestions" :key="s.id"
        class="px-2 py-1 text-[11px] cursor-pointer hover:bg-slate-50 flex items-center justify-between"
        @mousedown.prevent="pick(s.id)"
      >
        <span class="font-medium text-primary">{{ s.id }}</span>
        <span class="text-muted">{{ s.type }} · deg {{ s.degree }}</span>
      </li>
    </ul>
  </div>
</template>
