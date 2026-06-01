// Singleton state for the Timeline parsing settings modal. Opened from the
// Activity Timeline panel drawer; mounted once globally (App.vue).
import { ref } from 'vue'

const open = ref(false)

export function useTimelineSettingsModal() {
  return {
    open,
    openTimelineSettings: () => { open.value = true },
    closeTimelineSettings: () => { open.value = false },
  }
}
