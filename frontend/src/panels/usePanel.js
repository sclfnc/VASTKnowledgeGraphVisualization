// Boilerplate composable shared by every D3 wiki panel.
// Encapsulates spec lookup, controls state initialization, and contextual explanation.
// panelId is optional — used only as fallback when the host doesn't pass `panelSpec` (rare).
import { ref, computed } from 'vue'
import { PANEL_SPECS } from './index.js'

export function usePanel(props, panelId = null, dataRef = null) {
  const ownSpec = computed(
    () => props.panelSpec || (panelId ? PANEL_SPECS.find(p => p.id === panelId) : null)
  )

  const initial = Object.fromEntries(
    Object.entries(ownSpec.value?.controlsSchema || {}).map(([k, s]) => [k, s.default])
  )
  const controls = ref(initial)

  const explanation = computed(() => {
    const fn = ownSpec.value?.contextualizeExplanation
    if (typeof fn === 'function') return fn(props.schema, dataRef?.value ?? null)
    return ownSpec.value?.explanation || ''
  })

  const updateControl = (key, value) => { controls.value[key] = value }

  return { ownSpec, controls, explanation, updateControl }
}
