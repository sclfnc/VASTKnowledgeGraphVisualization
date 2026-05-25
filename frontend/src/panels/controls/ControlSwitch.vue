<script setup>
defineProps({
  label: String,
  modelValue: Boolean,
})

const emit = defineEmits(['update:modelValue'])
</script>

<template>
  <button
    class="flex items-center gap-1.5 text-[11px] transition cursor-pointer select-none"
    :class="modelValue ? 'text-primary' : 'text-muted hover:text-secondary'"
    @click="emit('update:modelValue', !modelValue)"
  >
    <span
      class="relative inline-flex items-center h-3 rounded-full transition-colors duration-200 shrink-0"
      :class="modelValue ? 'bg-slate-900' : 'bg-slate-300'"
      style="width: 22px;"
    >
      <span
        class="absolute w-2 h-2 bg-white rounded-full shadow transition-transform duration-200"
        :class="modelValue ? 'translate-x-3' : 'translate-x-0.5'"
      />
    </span>
    <span>{{ label }}</span>
  </button>
</template>
