// Timeline composable: refetches when graphId or the timeline overrides
// (per graph_id, in the Pinia store) change.
import { createGraphResource } from './createGraphResource.js'
import { useTimelineOverrides } from '@/stores/timelineOverrides.js'

export const useTimeline = createGraphResource('timeline', {
  query: (id) => {
    if (!id) return null
    const payload = useTimelineOverrides().serializedForGraph(id)
    return payload ? `overrides=${encodeURIComponent(payload)}` : null
  },
})
