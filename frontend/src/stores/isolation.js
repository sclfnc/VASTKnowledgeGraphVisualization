// Per-panel Isolation store (full freeze). Snapshots must be deep-cloned by the caller —
// live references would let post-Lock mutations leak through and break the freeze.
import { defineStore } from 'pinia'
import { ref } from 'vue'

export const useIsolationStore = defineStore('isolation', () => {
  const snapshots = ref({})  // [panelId] → snapshot

  function freeze(panelId, snapshot) {
    snapshots.value = { ...snapshots.value, [panelId]: snapshot }
  }

  function unfreeze(panelId) {
    if (!(panelId in snapshots.value)) return
    const next = { ...snapshots.value }
    delete next[panelId]
    snapshots.value = next
  }

  function isFrozen(panelId) {
    return panelId in snapshots.value
  }

  function snapshotOf(panelId) {
    return snapshots.value[panelId] ?? null
  }

  function clearAll() {
    snapshots.value = {}
  }

  return { snapshots, freeze, unfreeze, isFrozen, snapshotOf, clearAll }
})
