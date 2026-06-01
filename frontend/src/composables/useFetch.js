// EXTENSION: shared fetch wrapper — { data, loading, error, run }.
// Centralizes loading state, error parsing (FastAPI `detail`), and JSON decoding.
//
// Race safety: each `run()` call bumps a monotonic generation token; resolvers
// for superseded requests are dropped. Without this, rapid graphId switches
// could let an older response overwrite the newer one.
import { ref } from 'vue'

export function useFetch() {
  const data = ref(null)
  const loading = ref(false)
  const error = ref(null)
  let gen = 0

  async function run(input, init) {
    const myGen = ++gen
    loading.value = true
    error.value = null
    try {
      const res = await fetch(input, init)
      // 204 No Content (or empty body) → null payload but successful response.
      // Avoid misclassifying that as "data not loaded yet".
      const isEmpty = res.status === 204 || res.headers.get('content-length') === '0'
      const payload = isEmpty ? null : await res.json().catch(() => null)
      if (myGen !== gen) return null
      if (!res.ok) {
        throw new Error(payload?.detail ?? `Request failed (${res.status})`)
      }
      data.value = payload
      return payload
    } catch (e) {
      if (myGen !== gen) return null
      error.value = e.message ?? 'Request failed.'
      data.value = null
      return null
    } finally {
      if (myGen === gen) loading.value = false
    }
  }

  return { data, loading, error, run }
}
