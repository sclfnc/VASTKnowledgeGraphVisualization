// Shared props contract for every D3 wiki panel.
// Use as: const props = defineProps(PANEL_PROPS)
export const PANEL_PROPS = {
  panelSpec: { type: Object, required: true },
  schema: { type: Object, default: null },
  graphId: { type: String, default: null },
  showExplanation: { type: Boolean, default: false },
}
