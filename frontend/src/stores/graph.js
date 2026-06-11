// Graph store — graphId are in-memory only.
// API registry is in-memory too, so persisting across reloads would point at a
// stale graph.
import { defineStore } from 'pinia'
import { ref } from 'vue'

export const useGraphStore = defineStore('graph', () => {
  const graphId = ref(null)

  const setGraphId = (id) => {
    graphId.value = id
  }

  return { graphId, setGraphId }
})
