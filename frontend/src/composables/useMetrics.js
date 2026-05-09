import { watch, isRef, toValue } from 'vue'
import { apiUrl } from './useApi.js'
import { useFetch } from './useFetch.js'

export function useMetrics(graphId) {
  const { data: metrics, loading, error, run } = useFetch()

  async function load(id) {
    if (!id) {
      metrics.value = null
      return
    }
    await run(apiUrl(`/metrics/${id}`))
  }

  // Accept ref, computed, or plain string
  watch(() => toValue(graphId), load, { immediate: true })

  return { metrics, loading, error }
}
