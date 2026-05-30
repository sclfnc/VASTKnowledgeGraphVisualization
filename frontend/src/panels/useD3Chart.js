// Shared D3 chart lifecycle: observe size changes on a container ref and
// re-render via requestAnimationFrame. The render function is called on
// mount and on every resize tick.
//
// Pass an array of container refs when a panel has multiple SVGs that
// should share the resize loop (e.g. main chart + drill-down).
import { onMounted, onBeforeUnmount, toValue } from 'vue'

export function useD3Chart(containerRefOrRefs, render) {
  const refs = Array.isArray(containerRefOrRefs) ? containerRefOrRefs : [containerRefOrRefs]
  let observers = []
  let rafId = null

  function schedule() {
    if (rafId) cancelAnimationFrame(rafId)
    rafId = requestAnimationFrame(render)
  }

  onMounted(() => {
    for (const ref of refs) {
      const el = toValue(ref)
      if (!el) continue
      const ob = new ResizeObserver(schedule)
      ob.observe(el)
      observers.push(ob)
    }
    render()
  })

  onBeforeUnmount(() => {
    for (const ob of observers) ob.disconnect()
    observers = []
    if (rafId) cancelAnimationFrame(rafId)
  })

  // Return a manual trigger so callers can re-render on data changes
  // without re-wiring observers.
  return { rerender: schedule }
}
