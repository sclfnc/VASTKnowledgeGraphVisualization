// Per-panel Pin store. Effective masks = global AND pin (node-side; edge-side).
// Bitset words mutate in place — spread the outer object on each write so Pinia tracks it.
import { defineStore } from 'pinia'
import { ref } from 'vue'

export const usePinsStore = defineStore('pins', () => {
  const masks = ref({})  // [panelId] → { nodeMask: Bitset, edgeMask: Bitset | null }

  function pin(panelId, { nodeMask, edgeMask = null }) {
    masks.value = { ...masks.value, [panelId]: { nodeMask, edgeMask } }
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

  function nodeMaskFor(panelId) {
    return masks.value[panelId]?.nodeMask ?? null
  }

  function edgeMaskFor(panelId) {
    return masks.value[panelId]?.edgeMask ?? null
  }

  function clearAll() {
    masks.value = {}
  }

  return { masks, pin, unpin, isPinned, nodeMaskFor, edgeMaskFor, clearAll }
})
