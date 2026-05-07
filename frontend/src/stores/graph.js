// EXTENSION: graph store — graphId and mode are in-memory only.
// API registry is in-memory too, so persisting across reloads would point at a stale graph.
// mode resets to 'graph' on each new dataset to avoid lingering Guide state across loads.
import { defineStore } from 'pinia'
import { ref } from 'vue'

localStorage.removeItem('graph_id')
localStorage.removeItem('view_mode')

export const useGraphStore = defineStore('graph', () => {
  const graphId = ref(null)
  const mode = ref('graph')

  const setGraphId = (id) => {
    graphId.value = id
    mode.value = 'graph'
  }
  const setMode = (m) => { mode.value = m }

  return { graphId, mode, setGraphId, setMode }
})
