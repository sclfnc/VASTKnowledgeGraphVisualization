// Boilerplate composable shared by every D3 wiki panel: spec lookup + controls
// state initialized from the spec's controlsSchema defaults.
// panelId is optional — a fallback for the rare host that doesn't pass `panelSpec`.
import { ref } from 'vue'
import { PANEL_SPECS } from './index.js'

export function usePanel(props, panelId = null) {
  const spec = props.panelSpec || (panelId ? PANEL_SPECS.find(p => p.id === panelId) : null)

  const initial = Object.fromEntries(
    Object.entries(spec?.controlsSchema || {}).map(([k, s]) => [k, s.default])
  )
  const controls = ref(initial)

  const updateControl = (key, value) => { controls.value[key] = value }

  return { controls, updateControl }
}
