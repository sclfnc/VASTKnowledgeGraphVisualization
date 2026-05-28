// Cross-panel UI preferences. Today exposes a single shared direction slot
// consumed by `ego`, `ego_compare`, `cent_closeness` — instead of three
// independent panel-local toggles that never agree.
//
// Domain: 'undirected' | 'out' | 'in' | 'both'. Default 'undirected' (most
// neutral: every consumer opens in a safe state on any graph). In-memory:
// session-scoped, no persistence — graph switch keeps the preference, page
// reload resets it (no need to survive process restarts).
//
// Consumer mapping:
//   - ego / ego_compare expect 'out' | 'in' | 'both'   → 'undirected' maps to 'both'.
//   - cent_closeness expects 'undirected' | 'out' | 'in' → 'both' maps to 'undirected'.
// Each consumer reads its tailored computed below to stay inside its domain.
import { defineStore } from 'pinia'
import { ref, computed } from 'vue'

const VALID = new Set(['undirected', 'out', 'in', 'both'])

export const useUiPreferencesStore = defineStore('uiPreferences', () => {
  const direction = ref('undirected')

  function setDirection(next) {
    if (VALID.has(next)) direction.value = next
  }

  // BFS-domain mapping: 'undirected' → 'both' (union of in/out).
  const bfsDirection = computed(() =>
    direction.value === 'undirected' ? 'both' : direction.value,
  )

  // Closeness-domain mapping: 'both' → 'undirected' (no `both` variant exists
  // server-side; undirected is the closest safe fallback).
  const closenessDirection = computed(() =>
    direction.value === 'both' ? 'undirected' : direction.value,
  )

  return { direction, setDirection, bfsDirection, closenessDirection }
})
