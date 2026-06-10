// Panel state for the Guide view — which panels are active, in what order.
// Sidebar and GuideView both consume this store, so the sidebar can stay
// mounted in Graph mode (showing the same list, just not currently rendered).
import { defineStore } from 'pinia'
import { ref, watch, computed, markRaw } from 'vue'
import { PANEL_SPECS, SECTIONS } from '../panels/index.js'
import { useLocalStorage } from '../composables/useLocalStorage.js'

export const GUIDE_PANELS_KEY = 'guide_active_panels'

export const usePanelsStore = defineStore('panels', () => {
  const activeIds = useLocalStorage(
    GUIDE_PANELS_KEY,
    PANEL_SPECS.filter(p => p.defaultActive).map(p => p.id)
  )

  // markRaw the Vue component reference: Pinia's reactive proxy would otherwise
  // wrap it, triggering "Vue received a Component that was made a reactive object".
  const panels = ref(
    PANEL_SPECS.map(p => ({
      ...p,
      component: p.component ? markRaw(p.component) : p.component,
      active: activeIds.value.includes(p.id),
    }))
  )
  // sections must be a ref — storeToRefs() in consumers drops non-reactive
  // properties, so a plain `SECTIONS` exported as state would arrive as
  // undefined on the consumer side.
  const sections = ref(SECTIONS)

  watch(
    panels,
    () => { activeIds.value = panels.value.filter(p => p.active).map(p => p.id) },
    { deep: true }
  )

  // The filter already preserves panels.value array order, which is the
  // intended display order — a sort would be redundant.
  const orderedActive = computed(() =>
    panels.value.filter(p => p.active && p.component)
  )

  // Getters
  const getPanelsByView = computed(() => (view) => panels.value.filter(p => p.view === view))
  const getSectionsByView = computed(() => (view) => {
    const currentViewSections = panels.value.filter(p => p.view === view).map(p => p.section)
    return sections.value.filter(s => currentViewSections.includes(s))
  })

  const toggle = (p) => { if (!p.conditional) p.active = !p.active }
  const loadSection = (s) =>
    panels.value.filter(p => p.section === s && !p.conditional).forEach(p => { p.active = true })
  const removeSection = (s) =>
    panels.value.filter(p => p.section === s).forEach(p => { p.active = false })

  return { panels, sections, getPanelsByView, getSectionsByView, orderedActive, toggle, loadSection, removeSection }
})
