// Per-panel facade composing filters + pin + isolation + selection.
// Resolution: isolated → snapshot; pinned → activeNodeMask AND pin; else live.
// Selection follows the live store unless isolated.
import { computed, toRef } from 'vue'
import { useFilteredModel } from './useFilteredModel.js'
import { useGraphNodes } from './useGraphNodes.js'
import { useIsolationStore } from '@/stores/isolation.js'
import { usePinsStore } from '@/stores/pins.js'
import { useSelectionStore } from '@/stores/selection.js'
import { Bitset } from '@/utils/bitset.js'

// Sugar: panels pass `props` instead of unpacking panelSpec.id + toRef(graphId).
export function usePanelContextFromProps(props) {
  return usePanelContext(props.panelSpec.id, toRef(props, 'graphId'))
}

export function usePanelContext(panelId, graphId) {
  const isolation = useIsolationStore()
  const pins = usePinsStore()
  const selection = useSelectionStore()
  const live = useFilteredModel(graphId)
  const { nodes } = useGraphNodes(graphId)

  const isolated = computed(() => isolation.isFrozen(panelId))
  const pinned = computed(() => pins.isPinned(panelId))

  const activeNodeMask = computed(() => {
    if (isolated.value) {
      return isolation.snapshotOf(panelId)?.activeNodeMask ?? null
    }
    const base = live.activeNodeMask.value
    if (!base) return null
    const pin = pins.maskFor(panelId)
    if (!pin) return base
    const out = base.clone()
    out.andInPlace(pin)
    return out
  })

  const selectedIds = computed(() => {
    if (isolated.value) {
      return isolation.snapshotOf(panelId)?.selection ?? []
    }
    return selection.ids
  })

  const selectedMask = computed(() => {
    const soa = nodes.value
    if (!soa) return null
    const m = new Bitset(soa.N)
    for (const id of selectedIds.value) {
      const idx = soa.idToIdx.get(String(id))
      if (idx !== undefined) m.set(idx)
    }
    return m
  })

  // Returns true when no mask is ready yet, so initial paint isn't dim.
  function isActive(id) {
    const m = activeNodeMask.value
    const soa = nodes.value
    if (!m || !soa) return true
    const idx = soa.idToIdx.get(String(id))
    if (idx === undefined) return true
    return m.get(idx)
  }

  return {
    activeNodeMask,
    selectedIds,
    selectedMask,
    isActive,
    isolated,
    pinned,
  }
}
