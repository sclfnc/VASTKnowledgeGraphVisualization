// EXTENSION: fetch and reactively expose the schema for the active graph.
// Also resets the filters store whenever a new schema is loaded — keeps filter
// initialization in one place instead of relying on FiltersPanel being mounted.
import { watch } from 'vue'
import { apiUrl } from './useApi.js'
import { useFetch } from './useFetch.js'
import { useGraphStore } from '../stores/graph.js'
import { useFiltersStore } from '../stores/filters.js'

export function useSchema() {
  const graphStore = useGraphStore()
  const filters = useFiltersStore()
  const { data: schema, error, run } = useFetch()

  async function load(id) {
    if (!id) {
      schema.value = null
      filters.reset(null)
      return
    }
    const result = await run(apiUrl(`/schema/${id}`))
    filters.reset(result)
  }

  watch(() => graphStore.graphId, load, { immediate: true })

  return { schema, error }
}
