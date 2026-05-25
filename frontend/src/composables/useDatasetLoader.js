// EXTENSION: shared dataset loading logic — used by onboarding view and header switcher
import { apiUrl } from './useApi.js'
import { useFetch } from './useFetch.js'
import { useGraphStore } from '../stores/graph.js'
import { GUIDE_PANELS_KEY } from '../stores/panels.js'

export function useDatasetLoader() {
  const graphStore = useGraphStore()
  const { loading, error, run } = useFetch()

  async function call(input, init) {
    const data = await run(input, init)
    if (data?.graph_id) {
      localStorage.removeItem(GUIDE_PANELS_KEY)
      graphStore.setGraphId(data.graph_id)
    }
    return data
  }

  const loadBuiltin = (name) =>
    call(apiUrl(`/datasets/load/${name}`), { method: 'POST' })

  const uploadFile = (file, name = null) => {
    const form = new FormData()
    form.append('file', file)
    if (name) form.append('name', name)
    return call(apiUrl('/upload/'), { method: 'POST', body: form })
  }

  return { loading, error, loadBuiltin, uploadFile }
}

export async function fetchDatasets() {
  const { run } = useFetch()
  const data = await run(apiUrl('/datasets/'))
  return data?.datasets ?? []
}
