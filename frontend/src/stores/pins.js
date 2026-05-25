// Per-panel Pin store. Effective mask = globalActiveNodeMask AND pin.
// Bitset words mutate in place — spread the outer object on each write so Pinia tracks it.
import { defineStore } from 'pinia'
import { ref } from 'vue'

export const usePinsStore = defineStore('pins', () => {
  const masks = ref({})  // [panelId] → Bitset

  function pin(panelId, bitset) {
    masks.value = { ...masks.value, [panelId]: bitset }
  }

  function unpin(panelId) {
    if (!(panelId in masks.value)) return
    const next = { ...masks.value }
    delete next[panelId]
    masks.value = next
  }

  function isPinned(panelId) {
    return panelId in masks.value
  }

  function maskFor(panelId) {
    return masks.value[panelId] ?? null
  }

  function clearAll() {
    masks.value = {}
  }

  return { masks, pin, unpin, isPinned, maskFor, clearAll }
})
