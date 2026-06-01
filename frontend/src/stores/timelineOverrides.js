// Per-graph_id overrides for the timeline parsing strategy.
// Shape: { [graph_id]: { [attr_name]: { strategy, pattern? } } }
// Persisted in localStorage via useLocalStorage (same key across tabs).
import { defineStore } from 'pinia'

import { useLocalStorage } from '@/composables/useLocalStorage.js'

export const useTimelineOverrides = defineStore('timelineOverrides', () => {
  const all = useLocalStorage('telescope:timelineOverrides', {})

  function setForAttr(graphId, attr, override) {
    const next = { ...all.value[graphId] }
    if (override == null) delete next[attr]
    else next[attr] = override
    all.value = { ...all.value, [graphId]: next }
  }

  function clearForGraph(graphId) {
    const next = { ...all.value }
    delete next[graphId]
    all.value = next
  }

  function getForGraph(graphId) {
    return all.value[graphId] ?? {}
  }

  // JSON-serialized string for the API query param; null if no overrides set.
  function serializedForGraph(graphId) {
    const o = all.value[graphId]
    return (o && Object.keys(o).length) ? JSON.stringify(o) : null
  }

  return { all, setForAttr, clearForGraph, getForGraph, serializedForGraph }
})
