// Reactive fetch of /effective-types/{id}. Returns the per-item label
// arrays plus the resolved {attr, kind} so panels can:
//   1. group/color by the effective type via useEffectiveType (item lookup);
//   2. render captions ("Discriminator: club (auto-detected)").
//
// Query params (`node_attr`, `edge_attr`) come from the typePromotion store.
// Empty params = use schema.auto_promoted; manual override (Phase 7+) sets them.
import { computed, inject, toValue, watch } from 'vue'
import { apiUrl } from './useApi.js'
import { useFetch } from './useFetch.js'
import { useTypePromotionStore } from '@/stores/typePromotion.js'

const INJECT_KEY = 'effectiveTypes'

export function useEffectiveTypes(graphId) {
  const { data, loading, error, run } = useFetch()
  const promotion = useTypePromotionStore()

  const queryRef = computed(() => {
    const params = []
    if (promotion.node?.attr) params.push(`node_attr=${encodeURIComponent(promotion.node.attr)}`)
    if (promotion.edge?.attr) params.push(`edge_attr=${encodeURIComponent(promotion.edge.attr)}`)
    return params.length ? params.join('&') : null
  })

  async function load() {
    const id = toValue(graphId)
    if (!id) { data.value = null; return }
    const qs = queryRef.value
    await run(apiUrl(`/effective-types/${id}`) + (qs ? `?${qs}` : ''))
  }

  watch([() => toValue(graphId), queryRef], load, { immediate: true })

  return { data, loading, error }
}

export function injectEffectiveTypes(graphIdFallback) {
  const provided = inject(INJECT_KEY, null)
  if (provided) return provided
  return useEffectiveTypes(graphIdFallback)
}

export { INJECT_KEY as EFFECTIVE_TYPES_KEY }
