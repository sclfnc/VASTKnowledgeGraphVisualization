<script setup>
defineProps({
  label: String,
  spec: Object, // { type, options, default }
  modelValue: [String, Number],
})

const emit = defineEmits(['update:modelValue'])
</script>

<template>
  <div class="flex flex-col gap-1">
    <label class="text-sm font-medium text-slate-700">{{ label }}</label>
    <select
      :value="modelValue"
      @change="emit('update:modelValue', $event.target.value)"
      class="px-3 py-2 text-sm border border-slate-300 rounded bg-white hover:border-slate-400 focus:outline-none focus:ring-2 focus:ring-sky-600"
    >
      <option v-for="opt in spec.options" :key="opt" :value="opt">
        {{ opt }}
      </option>
    </select>
  </div>
</template>
