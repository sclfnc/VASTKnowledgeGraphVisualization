<script setup>
// Shared shell: renders explanation (only inside PanelFocus), controls bar, and a slot for the chart.
import { computed } from 'vue'
import { CONTROL_COMPONENTS } from './controls/index.js'

const props = defineProps({
  explanation: { type: String, default: '' },
  controlsSchema: { type: Object, default: () => ({}) },
  controls: { type: Object, required: true },
  showExplanation: { type: Boolean, default: false },
})

defineEmits(['update'])

const hasControls = computed(
  () => props.controlsSchema && Object.keys(props.controlsSchema).length > 0
)
</script>

<template>
  <div class="flex flex-col gap-4">
    <div
      v-if="showExplanation && explanation"
      class="text-sm text-slate-600 p-3 bg-slate-50 rounded border border-slate-200"
    >
      {{ explanation }}
    </div>

    <div
      v-if="hasControls"
      class="flex flex-wrap gap-3 pb-3 border-b border-slate-200"
    >
      <component
        v-for="(spec, key) in controlsSchema"
        :key="key"
        :is="CONTROL_COMPONENTS[spec.type]"
        :spec="spec"
        :label="spec.label"
        :modelValue="controls[key]"
        @update:modelValue="$emit('update', key, $event)"
      />
    </div>

    <slot />
  </div>
</template>
