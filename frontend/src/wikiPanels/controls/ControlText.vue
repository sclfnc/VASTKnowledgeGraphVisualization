<script setup>
defineProps({
  label: String,
  spec: Object,
  modelValue: String,
})

const emit = defineEmits(['update:modelValue'])
</script>

<template>
  <div class="flex flex-col gap-1">
    <label class="text-sm font-medium text-slate-700">{{ label }}</label>
    <input
      type="text"
      :value="modelValue"
      @input="emit('update:modelValue', $event.target.value)"
      class="px-3 py-2 text-sm border border-slate-300 rounded bg-white hover:border-slate-400 focus:outline-none focus:ring-2 focus:ring-blue-500"
      placeholder="Enter value..."
    />
  </div>
</template>
