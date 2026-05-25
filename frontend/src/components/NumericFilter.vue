<script setup>
// EXTENSION: numeric filter widget — absolute slider, percentile slider, or IQR outlier toggle.
// Shape of v-model: { mode: 'absolute' | 'percentile' | 'outliers', value }
//   absolute   -> value = [min, max] within `range`
//   percentile -> value = [pLow, pHigh] in [0, 100]
//   outliers   -> value = 'hide' | 'show'
import { computed } from 'vue'
import { SlidersHorizontal } from 'lucide-vue-next'

const props = defineProps({
  modelValue: { type: Object, required: true },
  range: { type: Array, default: () => [0, 0] },  // [absMin, absMax]
  label: { type: String, default: '' },
})
const emit = defineEmits(['update:modelValue'])

const state = computed({
  get: () => props.modelValue,
  set: (v) => emit('update:modelValue', v),
})

const setMode = (mode) => {
  if (mode === 'absolute')   state.value = { mode, value: [...props.range] }
  if (mode === 'percentile') state.value = { mode, value: [0, 100] }
  if (mode === 'outliers')   state.value = { mode, value: 'hide' }
}

const setLow  = (e) => { state.value = { ...state.value, value: [Number(e.target.value), state.value.value[1]] } }
const setHigh = (e) => { state.value = { ...state.value, value: [state.value.value[0], Number(e.target.value)] } }
</script>

<template>
  <div class="space-y-1">
    <div class="flex items-center justify-between">
      <span class="flex items-center gap-1 text-xs font-medium text-secondary">
        <SlidersHorizontal :size="11" class="text-muted" />
        {{ label }}
      </span>
      <select
        :value="state.mode"
        class="input-base px-1 py-0.5 text-[10px] text-secondary"
        @change="setMode($event.target.value)"
      >
        <option value="absolute">Absolute</option>
        <option value="percentile">Percentile</option>
        <option value="outliers">Outliers (IQR)</option>
      </select>
    </div>

    <template v-if="state.mode === 'absolute'">
      <div class="flex items-center gap-1 text-[10px] text-secondary">
        <input type="number" :min="range[0]" :max="range[1]" :value="state.value[0]" class="input-base w-full px-1 py-0.5" @input="setLow">
        <span>—</span>
        <input type="number" :min="range[0]" :max="range[1]" :value="state.value[1]" class="input-base w-full px-1 py-0.5" @input="setHigh">
      </div>
      <p class="text-[10px] text-muted">range: {{ range[0] }}–{{ range[1] }}</p>
    </template>

    <template v-else-if="state.mode === 'percentile'">
      <div class="flex items-center gap-1 text-[10px] text-secondary">
        <input type="number" min="0" max="100" :value="state.value[0]" class="input-base w-full px-1 py-0.5" @input="setLow">
        <span>—</span>
        <input type="number" min="0" max="100" :value="state.value[1]" class="input-base w-full px-1 py-0.5" @input="setHigh">
      </div>
      <p class="text-[10px] text-muted">presets: 25–75 · 10–90</p>
    </template>

    <template v-else>
      <div class="flex gap-1 text-[10px]">
        <button
          class="flex-1 rounded-lg border px-1 py-0.5"
          :class="state.value === 'hide' ? 'border-slate-700 bg-slate-700 text-white' : 'border-slate-200 text-secondary'"
          @click="state = { mode: 'outliers', value: 'hide' }"
        >hide outliers</button>
        <button
          class="flex-1 rounded-lg border px-1 py-0.5"
          :class="state.value === 'show' ? 'border-slate-700 bg-slate-700 text-white' : 'border-slate-200 text-secondary'"
          @click="state = { mode: 'outliers', value: 'show' }"
        >only outliers</button>
      </div>
    </template>
  </div>
</template>
