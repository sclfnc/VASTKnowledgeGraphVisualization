<script setup>
// Pill-style segmented control. Single-select. Options are { k, label, disabled? }.
defineProps({
  modelValue: { type: [String, Boolean, Number], default: null },
  options: { type: Array, required: true },
})
const emit = defineEmits(['update:modelValue'])
</script>

<template>
  <div class="segmented-track inline-flex w-full items-center text-[10px] font-medium">
    <button
      v-for="opt in options" :key="String(opt.k)"
      class="segmented-pill flex-1 px-2 py-0.5"
      :class="{
        'segmented-pill--active': modelValue === opt.k,
        'segmented-pill--disabled': opt.disabled,
      }"
      :disabled="opt.disabled"
      :title="opt.title || ''"
      @click="!opt.disabled && emit('update:modelValue', opt.k)"
    >{{ opt.label }}</button>
  </div>
</template>
