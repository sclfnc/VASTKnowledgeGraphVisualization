<script setup>
// Wraps a single-handle @vueform/slider inside a ControlSection with the
// standard drawer padding. Used by panels with multiple sliders in their
// drawer (EgoNetworkPanel: k-hop's siblings, cap, linkDistance, charge).
//
// For range sliders (dual-handle) keep using `<Slider v-model="...">` inline:
// the API surface diverges from the single-handle wrapper enough that a
// generic SliderControl wouldn't simplify the call site.
import Slider from '@vueform/slider'
import '@vueform/slider/themes/default.css'
import ControlSection from './ControlSection.vue'

defineProps({
  title:      { type: String, required: true },
  modelValue: { type: Number, required: true },
  min:        { type: Number, required: true },
  max:        { type: Number, required: true },
  step:       { type: Number, default: 1 },
  tooltips:   { type: Boolean, default: true },
  lazy:       { type: Boolean, default: false },
})

defineEmits(['update:modelValue'])
</script>

<template>
  <ControlSection :title="title">
    <div class="px-1 pt-1 pb-2">
      <Slider
        :model-value="modelValue"
        :min="min"
        :max="max"
        :step="step"
        :tooltips="tooltips"
        :lazy="lazy"
        @update="$emit('update:modelValue', $event)"
      />
    </div>
  </ControlSection>
</template>
