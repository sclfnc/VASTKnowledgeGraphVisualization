<script setup>
// Wraps a single-handle @vueform/slider inside a ControlSection with the
// standard drawer padding. Used by panels with multiple sliders in their
// drawer (EgoNetworkPanel: cap, linkDistance, charge).
//
// Visual parity with RangeFilter: no floating tooltip; the current value lives
// in an editable number box at the right end (single handle → single box, no
// Abs/% toggle). Typing commits on blur/Enter.
//
// For range sliders (dual-handle) keep using RangeFilter / inline `<Slider>`.
import { ref, watch } from 'vue'
import Slider from '@vueform/slider'
import '@vueform/slider/themes/default.css'
import ControlSection from './ControlSection.vue'

const props = defineProps({
  title:      { type: String, required: true },
  modelValue: { type: Number, required: true },
  min:        { type: Number, required: true },
  max:        { type: Number, required: true },
  step:       { type: Number, default: 1 },
  lazy:       { type: Boolean, default: false },
  colSpan:    { type: [Number, String], default: 1 },
})

const emit = defineEmits(['update:modelValue'])

const boxInput = ref(String(props.modelValue))
watch(() => props.modelValue, v => { boxInput.value = String(v) })

function clamp(v) {
  return Math.max(props.min, Math.min(props.max, v))
}

function commitBox() {
  const v = Number(boxInput.value)
  if (!Number.isFinite(v)) { boxInput.value = String(props.modelValue); return }
  emit('update:modelValue', clamp(v))
}
</script>

<template>
  <ControlSection :title="title" :col-span="colSpan">
    <div class="flex items-center gap-1.5 px-1 pt-1 pb-1">
      <div class="flex-1">
        <Slider
          :model-value="modelValue"
          :min="min"
          :max="max"
          :step="step"
          :tooltips="false"
          :lazy="lazy"
          @update="$emit('update:modelValue', $event)"
        />
      </div>
      <input
        v-model="boxInput"
        type="number"
        class="input-base no-spin w-12 px-0.5 py-0 text-[10px] leading-tight tabular-nums text-center"
        @blur="commitBox"
        @keydown.enter="commitBox"
      />
    </div>
  </ControlSection>
</template>
