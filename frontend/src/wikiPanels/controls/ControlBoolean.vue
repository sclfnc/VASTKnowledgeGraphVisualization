<script setup>
import { Eye, EyeOff } from 'lucide-vue-next'

defineProps({
  label: String,
  spec: Object,
  modelValue: Boolean,
  disabled: { type: Boolean, default: false },
})

const emit = defineEmits(['update:modelValue'])
</script>

<template>
  <button
    class="flex items-center gap-1.5 text-[11px] transition"
    :class="disabled
      ? 'text-slate-300 cursor-not-allowed'
      : modelValue
        ? 'text-slate-600 hover:text-slate-800'
        : 'text-slate-400 hover:text-slate-600'"
    :disabled="disabled"
    @click="!disabled && emit('update:modelValue', !modelValue)"
  >
    <component :is="modelValue ? Eye : EyeOff" :size="13" />
    <span>{{ label }}</span>
  </button>
</template>
