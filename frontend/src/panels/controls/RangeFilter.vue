<script setup>
// Range filter primitive: two editable number inputs on either side of a
// slider, plus a Mode toggle (Absolute / Percentile). The binding works both
// ways — dragging the handles updates the inputs, typing updates the slider.
//
// Mode is UI state only; the emitted `range` is **always** in absolute units,
// so consumers (filters store + useFilteredModel) don't need to know whether
// the user picked it by absolute values or by percentiles. Percentile-mode
// conversion uses the `sorted` array from the backend attribute index when
// available (for accurate empirical percentiles), or falls back to linear
// interpolation between min/max.
import { computed, ref, watch } from 'vue'
import Slider from '@vueform/slider'
import '@vueform/slider/themes/default.css'

const props = defineProps({
  /** Current range in **absolute** units. */
  modelValue: { type: Array, default: () => [0, 0] },
  /** Full domain in **absolute** units, used for clamp + percentile mapping. */
  fullRange:  { type: Array, required: true },
  /** Optional sorted `[idx, value]` pairs from attribute_index — when present,
   *  percentile↔absolute conversion uses the empirical CDF. */
  sortedPairs: { type: Array, default: null },
  /** integer step on the slider; null lets @vueform pick by domain size. */
  step:        { type: Number, default: null },
  /** v-model:mode — 'absolute' | 'percentile'. Controlled by parent so the
   *  toggle UI can live next to the section title. */
  mode:        { type: String, default: 'absolute' },
})

const emit = defineEmits(['update:modelValue'])

const mode = computed(() => props.mode)

// Empirical percentile <-> absolute via the sorted value array. If no pairs,
// fall back to linear interpolation on [fullRange[0], fullRange[1]].
const sortedValues = computed(() => {
  if (Array.isArray(props.sortedPairs) && props.sortedPairs.length > 0) {
    return props.sortedPairs.map(p => p[1])
  }
  return null
})

function percentileToAbsolute(p) {
  p = Math.max(0, Math.min(100, p))
  const arr = sortedValues.value
  if (!arr || arr.length === 0) {
    const [lo, hi] = props.fullRange
    return lo + (hi - lo) * (p / 100)
  }
  const idx = Math.min(arr.length - 1, Math.floor((p / 100) * (arr.length - 1)))
  return arr[idx]
}

function absoluteToPercentile(v) {
  const arr = sortedValues.value
  if (!arr || arr.length === 0) {
    const [lo, hi] = props.fullRange
    if (hi === lo) return 0
    return Math.max(0, Math.min(100, ((v - lo) / (hi - lo)) * 100))
  }
  // Binary search: first index >= v → percentile = idx / (n-1) * 100.
  let lo = 0, hi = arr.length
  while (lo < hi) {
    const mid = (lo + hi) >>> 1
    if (arr[mid] < v) lo = mid + 1
    else hi = mid
  }
  return Math.max(0, Math.min(100, (lo / Math.max(1, arr.length - 1)) * 100))
}

// Slider sees values in the active mode's units (absolute or 0..100).
const sliderMin = computed(() => mode.value === 'percentile' ? 0 : props.fullRange[0])
const sliderMax = computed(() => mode.value === 'percentile' ? 100 : props.fullRange[1])
const sliderStep = computed(() => {
  if (mode.value === 'percentile') return 1
  return props.step ?? -1
})

const sliderValue = computed(() => {
  const [absLo, absHi] = props.modelValue
  if (mode.value === 'percentile') {
    return [Math.round(absoluteToPercentile(absLo)), Math.round(absoluteToPercentile(absHi))]
  }
  return [absLo, absHi]
})

// Local refs for the editable inputs, in the current mode's units.
const minInput = ref('')
const maxInput = ref('')

function syncInputsFromSlider(v) {
  minInput.value = String(v[0])
  maxInput.value = String(v[1])
}

watch(sliderValue, syncInputsFromSlider, { immediate: true })

function emitAbsolute(absLo, absHi) {
  const [lo, hi] = props.fullRange
  absLo = Math.max(lo, Math.min(hi, absLo))
  absHi = Math.max(lo, Math.min(hi, absHi))
  if (absLo > absHi) [absLo, absHi] = [absHi, absLo]
  emit('update:modelValue', [absLo, absHi])
}

function onSliderUpdate(v) {
  if (mode.value === 'percentile') {
    emitAbsolute(percentileToAbsolute(v[0]), percentileToAbsolute(v[1]))
  } else {
    emitAbsolute(Number(v[0]), Number(v[1]))
  }
}

function commitInputs() {
  const lo = Number(minInput.value)
  const hi = Number(maxInput.value)
  if (!Number.isFinite(lo) || !Number.isFinite(hi)) {
    // Revert
    syncInputsFromSlider(sliderValue.value)
    return
  }
  if (mode.value === 'percentile') {
    emitAbsolute(percentileToAbsolute(lo), percentileToAbsolute(hi))
  } else {
    emitAbsolute(lo, hi)
  }
}

// When `mode` (prop) flips, the displayed unit system changes — re-sync the
// inputs from the slider's new computed value. The absolute stored value is
// untouched (it's the source of truth).
watch(() => props.mode, () => { syncInputsFromSlider(sliderValue.value) })
</script>

<template>
  <div class="flex flex-col">
    <!-- Inputs on either side of the slider: typing commits on blur/Enter.
         Mode is controlled by the parent (v-model:mode) so the toggle UI
         can be placed next to the section title. -->
    <div class="flex items-center gap-1.5">
      <input
        v-model="minInput"
        type="number"
        class="input-base no-spin w-10 px-0.5 py-0 text-[10px] leading-tight tabular-nums text-center"
        @blur="commitInputs"
        @keydown.enter="commitInputs"
      />
      <div class="flex-1 px-1">
        <Slider
          :model-value="sliderValue"
          :min="sliderMin"
          :max="sliderMax"
          :step="sliderStep"
          :tooltips="false"
          @update="onSliderUpdate"
        />
      </div>
      <input
        v-model="maxInput"
        type="number"
        class="input-base no-spin w-10 px-0.5 py-0 text-[10px] leading-tight tabular-nums text-center"
        @blur="commitInputs"
        @keydown.enter="commitInputs"
      />
    </div>
  </div>
</template>
