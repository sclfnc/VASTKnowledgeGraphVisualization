import { watch, toValue } from 'vue'
import { apiUrl } from './useApi.js'
import { useFetch } from './useFetch.js'

export function useDegreeFit(graphId) {
  const { data: fit, loading, error, run } = useFetch()

  async function load(id) {
    if (!id) { fit.value = null; return }
    await run(apiUrl(`/degree-fit/${id}`))
  }

  watch(() => toValue(graphId), load, { immediate: true })

  return { fit, loading, error }
}
