<script setup>
const props = defineProps({
  label: String,
  spec: Object,   // { options: [a, b] }
  modelValue: String,
})

const emit = defineEmits(['update:modelValue'])
</script>

<template>
  <div class="flex items-center gap-1.5">
    <span v-if="label" class="text-[11px] text-slate-500 mr-0.5">{{ label }}</span>
    <div class="flex rounded-md border border-slate-200 overflow-hidden text-[11px] font-medium">
      <button
        v-for="opt in spec.options"
        :key="opt"
        class="px-2.5 py-1 transition-colors"
        :class="modelValue === opt
          ? 'bg-sky-600 text-white'
          : 'bg-white text-slate-500 hover:bg-slate-50'"
        @click="emit('update:modelValue', opt)"
      >
        {{ opt }}
      </button>
    </div>
  </div>
</template>
