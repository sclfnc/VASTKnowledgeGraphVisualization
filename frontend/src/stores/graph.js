// EXTENSION: graph store — graphId and mode are in-memory only.
// API registry is in-memory too, so persisting across reloads would point at a stale graph.
// mode resets to 'guide' on each new dataset so the user lands on the exploratory view.
import { defineStore } from 'pinia'
import { ref } from 'vue'

localStorage.removeItem('graph_id')
localStorage.removeItem('view_mode')

export const useGraphStore = defineStore('graph', () => {
  const graphId = ref(null)
  const mode = ref('guide')

  const setGraphId = (id) => {
    graphId.value = id
    mode.value = 'guide'
  }
  const setMode = (m) => { mode.value = m }

  return { graphId, mode, setGraphId, setMode }
})
