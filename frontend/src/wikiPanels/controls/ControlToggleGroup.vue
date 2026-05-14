<script setup>
// Pill-style segmented control. Single-select. Options are { k, label, disabled? }.
defineProps({
  modelValue: { type: [String, Boolean, Number], default: null },
  options: { type: Array, required: true },
})
const emit = defineEmits(['update:modelValue'])
</script>

<template>
  <div class="flex w-full rounded border border-slate-200 overflow-hidden text-[10px] font-medium">
    <button
      v-for="opt in options" :key="String(opt.k)"
      class="flex-1 py-0.5 transition-colors"
      :class="opt.disabled
        ? 'bg-slate-50 text-slate-300 cursor-not-allowed'
        : modelValue === opt.k
          ? 'bg-sky-600 text-white'
          : 'bg-white text-slate-500 hover:bg-slate-50'"
      :disabled="opt.disabled"
      :title="opt.title || ''"
      @click="!opt.disabled && emit('update:modelValue', opt.k)"
    >{{ opt.label }}</button>
  </div>
</template>
