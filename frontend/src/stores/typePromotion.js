// Per-session manual promotion overrides. Today only a placeholder for
// Phase 7+ (manual promote UI). The composable useEffectiveTypes reads
// schema.auto_promoted by default; when manual.node / manual.edge is set,
// it forwards to /effective-types/ with the override query.
//
// Shape: `{attr: string, kind: string} | null`. Reset on graph change
// (via useSchema's tearDownCrossGraphState).
import { defineStore } from 'pinia'
import { ref } from 'vue'

export const useTypePromotionStore = defineStore('typePromotion', () => {
  const node = ref(null)   // {attr, kind} | null — user override
  const edge = ref(null)

  function setNode(promo) { node.value = promo }
  function setEdge(promo) { edge.value = promo }
  function clear() { node.value = null; edge.value = null }

  return { node, edge, setNode, setEdge, clear }
})
