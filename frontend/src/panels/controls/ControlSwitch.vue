<script setup>
// On/off slider with an inline label, for additive boolean modifiers.
defineProps({
  label: { type: String, default: '' },
  modelValue: { type: Boolean, default: false },
})
const emit = defineEmits(['update:model-value'])
</script>

<template>
  <button
    type="button"
    class="flex w-full items-center justify-between gap-2 rounded-md px-2 py-1 text-left text-[11px] transition hover:bg-slate-50"
    @click="emit('update:model-value', !modelValue)"
  >
    <span class="text-secondary">{{ label }}</span>
    <span
      class="relative inline-flex h-4 w-7 shrink-0 items-center rounded-full transition-colors"
      :class="modelValue ? 'bg-slate-900' : 'bg-slate-300'"
    >
      <span
        class="inline-block h-3 w-3 transform rounded-full bg-white shadow transition-transform"
        :class="modelValue ? 'translate-x-3.5' : 'translate-x-0.5'"
      />
    </span>
  </button>
</template>
