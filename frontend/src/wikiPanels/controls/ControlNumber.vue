<script setup>
defineProps({
  label: String,
  spec: Object, // { min, max, step, default }
  modelValue: Number,
})

const emit = defineEmits(['update:modelValue'])
</script>

<template>
  <div class="flex flex-col gap-1">
    <div class="flex justify-between items-baseline">
      <label class="text-sm font-medium text-slate-700">{{ label }}</label>
      <span class="text-sm font-mono text-slate-600">{{ modelValue }}</span>
    </div>
    <input
      type="range"
      :value="modelValue"
      :min="spec.min"
      :max="spec.max"
      :step="spec.step || 1"
      @input="emit('update:modelValue', parseFloat($event.target.value))"
      class="w-full h-2 bg-slate-200 rounded-lg appearance-none cursor-pointer accent-blue-600"
    />
  </div>
</template>
