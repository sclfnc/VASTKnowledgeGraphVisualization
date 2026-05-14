import { watch, toValue } from 'vue'
import { apiUrl } from './useApi.js'
import { useFetch } from './useFetch.js'

export function useComponents(graphId) {
  const { data: components, loading, error, run } = useFetch()

  async function load(id) {
    if (!id) { components.value = null; return }
    await run(apiUrl(`/components/${id}`))
  }

  watch(() => toValue(graphId), load, { immediate: true })

  return { components, loading, error }
}
