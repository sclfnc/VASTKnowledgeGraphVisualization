// Singleton state for the About modal. The modal itself is mounted once
// in App.vue; any component (header, sidebar, future spots) can open it
// via openAbout() without re-instantiating the modal or duplicating state.
import { ref } from 'vue'

const open = ref(false)

export function useAboutModal() {
  return {
    open,
    openAbout: () => { open.value = true },
    closeAbout: () => { open.value = false },
  }
}
