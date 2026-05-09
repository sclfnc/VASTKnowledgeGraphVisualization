<script setup>
defineProps({
  label: String,
  spec: Object,
  modelValue: Boolean,
})

const emit = defineEmits(['update:modelValue'])
</script>

<template>
  <div class="flex items-center gap-2">
    <input
      type="checkbox"
      :checked="modelValue"
      @change="emit('update:modelValue', $event.target.checked)"
      class="w-4 h-4 text-blue-600 rounded border-slate-300 focus:ring-2 focus:ring-blue-500"
    />
    <label class="text-sm font-medium text-slate-700">{{ label }}</label>
  </div>
</template>
