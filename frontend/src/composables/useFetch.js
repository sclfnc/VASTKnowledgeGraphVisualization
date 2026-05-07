// EXTENSION: shared fetch wrapper — { data, loading, error, run }.
// Centralizes loading state, error parsing (FastAPI `detail`), and JSON decoding.
import { ref } from 'vue'

export function useFetch() {
  const data = ref(null)
  const loading = ref(false)
  const error = ref(null)

  async function run(input, init) {
    loading.value = true
    error.value = null
    try {
      const res = await fetch(input, init)
      const payload = await res.json().catch(() => null)
      if (!res.ok) {
        throw new Error(payload?.detail ?? `Request failed (${res.status})`)
      }
      data.value = payload
      return payload
    } catch (e) {
      error.value = e.message ?? 'Request failed.'
      data.value = null
      return null
    } finally {
      loading.value = false
    }
  }

  return { data, loading, error, run }
}
