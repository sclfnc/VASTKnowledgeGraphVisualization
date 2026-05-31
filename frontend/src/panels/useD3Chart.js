// Shared D3 chart lifecycle: observe size changes on a container ref and
// re-render via requestAnimationFrame. The render function is called on
// mount and on every resize tick.
//
// Pass an array of container refs when a panel has multiple SVGs that
// should share the resize loop (e.g. main chart + drill-down).
//
// `spanFlags` (optional): a getter returning the reactive grid-span flags
// (e.g. `() => [props.widened, props.expanded]`). Maximize/widen change the
// card's grid span, and the ResizeObserver misses that transition tick on
// real browsers — so when these flags change we re-render after the layout
// settles. Double rAF: first frame applies the span, second reads the settled
// size. This is the single source of truth for span-driven re-rendering; do
// NOT re-implement the watch in panels.
import { onMounted, onBeforeUnmount, toValue, watch } from 'vue'

export function useD3Chart(containerRefOrRefs, render, spanFlags = null) {
  const refs = Array.isArray(containerRefOrRefs) ? containerRefOrRefs : [containerRefOrRefs]
  // Track the element each observer is bound to, so we can rebind when a
  // container mounts later (e.g. behind a v-else that flips once data arrives)
  // or swaps elements. A one-shot onMounted misses those — the panel renders
  // via the data watch but the window-resize observer never attaches.
  let observers = refs.map(() => ({ ob: null, el: null }))
  let rafId = null

  function schedule() {
    if (rafId) cancelAnimationFrame(rafId)
    rafId = requestAnimationFrame(render)
  }

  function syncObservers() {
    refs.forEach((ref, i) => {
      const el = toValue(ref)
      const slot = observers[i]
      if (el === slot.el) return
      if (slot.ob) slot.ob.disconnect()
      if (el) {
        const ob = new ResizeObserver(schedule)
        ob.observe(el)
        observers[i] = { ob, el }
      } else {
        observers[i] = { ob: null, el: null }
      }
    })
  }

  // Rebind whenever any tracked ref changes identity (mount / swap / unmount).
  watch(refs, syncObservers, { flush: 'post' })

  onMounted(() => {
    syncObservers()
    render()
  })

  if (spanFlags) {
    watch(spanFlags, () => {
      requestAnimationFrame(() => requestAnimationFrame(render))
    })
  }

  onBeforeUnmount(() => {
    for (const slot of observers) if (slot.ob) slot.ob.disconnect()
    observers = []
    if (rafId) cancelAnimationFrame(rafId)
  })

  // Return a manual trigger so callers can re-render on data changes
  // without re-wiring observers.
  return { rerender: schedule }
}
