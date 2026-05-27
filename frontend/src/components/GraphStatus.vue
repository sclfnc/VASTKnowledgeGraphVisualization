<script setup>
// Sidebar status block: where the user is (which graph + structural flags)
// + how much of it survives the current filter. Lives in AppSidebar between
// brand and ModeToggle, so it's always visible regardless of Contents/Filters
// mode.
//
// Doubles as the per-node inspector when the user selects nodes via the
// cross-panel selection contract: the bottom half resolves selection.ids[0]
// into raw attributes, structural counters and a small neighbor sample.
//
// Action-oriented filter UI (active chips, undo/redo, reset) stays in
// GraphHeaderStrip — this block is read-only state + metadata.
import { computed, ref, toRef, watch } from 'vue'
import { storeToRefs } from 'pinia'
import { ChevronDown, ChevronRight, Hash, ArrowRightToLine, ArrowRightFromLine, ArrowRight, ArrowLeftRight, X } from 'lucide-vue-next'
import { injectSchema } from '../composables/useSchema.js'
import { useGraphStore } from '../stores/graph.js'
import { useFilteredModel } from '../composables/useFilteredModel.js'
import { useEffectiveType } from '../composables/useEffectiveType.js'
import { useNodeTypeColors } from '../composables/useNodeTypeColors.js'
import { useNodeInspect } from '../composables/useNodeInspect.js'
import { useNodeNeighbors } from '../composables/useNodeNeighbors.js'
import { useEdgeInspect } from '../composables/useEdgeInspect.js'
import { useSelectionStore } from '../stores/selection.js'

const { schema } = injectSchema()
const { graphId } = storeToRefs(useGraphStore())
const { activeNodeMask, activeEdgeMask } = useFilteredModel(graphId)
const { promoted, nodeType: resolveEffectiveType } = useEffectiveType(graphId, schema)
const { color: typeColor } = useNodeTypeColors(schema)

const filteredNodeCount = computed(() => activeNodeMask.value?.popcount() ?? schema.value?.nodes ?? 0)
const filteredEdgeCount = computed(() => activeEdgeMask.value?.popcount() ?? schema.value?.edges ?? 0)
const noNodesActive = computed(() => filteredNodeCount.value === 0 && schema.value?.nodes > 0)

const structuralFlags = computed(() => {
  const s = schema.value
  if (!s) return []
  const flags = [s.directed ? 'directed' : 'undirected']
  if (s.weighted) flags.push('weighted')
  if (s.multigraph) flags.push('multigraph')
  if (s.bipartite) flags.push('bipartite')
  if (s.acyclic === true) flags.push('DAG')
  return flags
})

const promotionCaption = computed(() => {
  const p = promoted.value?.node
  return p ? `Discriminator: ${p.attr}` : null
})

// ─── Node Inspector — single source of "what is this node?". ──────────────
const MAX_QUEUE = 6

const selection = useSelectionStore()
const { ids: selectedIds } = storeToRefs(selection)

const focusedId = ref(null)
const inspectorOpen = ref(true)

watch(
  selectedIds,
  (ids) => {
    if (!ids?.length) {
      focusedId.value = null
    } else if (!focusedId.value || !ids.includes(focusedId.value)) {
      focusedId.value = ids[0]
    }
  },
  { immediate: true },
)

const { data: inspectData, loading: inspectLoading, error: inspectError } =
  useNodeInspect(graphId, focusedId)

const effectiveTypeLabel = computed(() => {
  if (!inspectData.value) return null
  return resolveEffectiveType(inspectData.value) || inspectData.value.type
})

const queueIds = computed(() => (selectedIds.value || []).slice(0, MAX_QUEUE))
const queueOverflow = computed(() =>
  Math.max(0, (selectedIds.value?.length ?? 0) - MAX_QUEUE))

const attrEntries = computed(() => {
  const obj = inspectData.value?.attributes ?? {}
  return Object.entries(obj).map(([k, v]) => ({ k, v }))
})

// Neighbor filter ('all' | 'in' | 'out') driven by the three structural boxes.
// Pure UI state — doesn't write to the selection store, just narrows what we
// render. Only meaningful on directed graphs.
const NEIGHBOR_PREVIEW = 6
const neighborFilter = ref('all')
const neighborsExpanded = ref(false)

watch(focusedId, () => {
  neighborFilter.value = 'all'
  neighborsExpanded.value = false
})

function toggleNeighborFilter(mode) {
  neighborFilter.value = (neighborFilter.value === mode) ? 'all' : mode
  neighborsExpanded.value = false
}

// Paginated neighbor source: composable handles offset/limit + abort on
// node/direction switch. Total + filtered counts come back from the server.
const {
  items: neighborItems,
  total: neighborTotal,
  filteredTotal: neighborFilteredTotal,
  loading: neighborsLoading,
  done: neighborsDone,
  loadMore: loadMoreNeighbors,
} = useNodeNeighbors(graphId, focusedId, neighborFilter)

const visibleNeighbors = computed(() =>
  neighborsExpanded.value
    ? neighborItems.value
    : neighborItems.value.slice(0, NEIGHBOR_PREVIEW),
)
const neighborOverflow = computed(() =>
  Math.max(0, neighborFilteredTotal.value - NEIGHBOR_PREVIEW))

// Infinite scroll: fire loadMore when the user reaches near the bottom of the
// scrollable container. Threshold = 80px gives time for the next page to
// arrive before the user hits the bottom.
const scrollContainer = ref(null)
function onNeighborsScroll(evt) {
  if (neighborsLoading.value || neighborsDone.value) return
  const el = evt.target
  if (el.scrollHeight - el.scrollTop - el.clientHeight < 80) {
    loadMoreNeighbors()
  }
}

const isDirected = computed(() => Boolean(schema.value?.directed))

// Hide the type chip when it carries no information: a single raw type
// across the graph AND no effective promotion in place (so the label would
// always be the same — usually "Unknown"). Same rule applies on edge side.
const showNodeTypeChip = computed(() => {
  const types = schema.value?.node_types ?? []
  const hasPromotion = Boolean(promoted.value?.node)
  return hasPromotion || types.length > 1
})

const showEdgeTypeChip = computed(() => {
  const types = schema.value?.edge_types ?? []
  const hasPromotion = Boolean(promoted.value?.edge)
  return hasPromotion || types.length > 1
})

// Promote an id to the head of the selection store. This is the canonical
// "focus" channel — EgoNetworkPanel and any other consumer that reads
// selection.ids[0] follows it. Just setting `focusedId` locally would only
// move the inspector card.
function promoteNode(id) {
  const ids = (selectedIds.value || []).slice()
  const i = ids.indexOf(id)
  if (i === -1) ids.unshift(id)
  else if (i !== 0) { ids.splice(i, 1); ids.unshift(id) }
  selection.replace(ids)
}

function promoteEdge(id) {
  const ids = (selectedEdgeIds.value || []).slice()
  const i = ids.indexOf(id)
  if (i === -1) ids.unshift(id)
  else if (i !== 0) { ids.splice(i, 1); ids.unshift(id) }
  selection.replaceEdges(ids)
}

function formatValue(v) {
  if (v === null || v === undefined) return '—'
  if (typeof v === 'boolean') return v ? 'true' : 'false'
  if (Array.isArray(v)) return v.length ? v.join(', ') : '[]'
  if (typeof v === 'object') return JSON.stringify(v)
  return String(v)
}

// ─── Edge Inspector — mirror of node block, keyed by edge_id. ─────────────
const { edgeIds: selectedEdgeIds } = storeToRefs(selection)
const focusedEdgeId = ref(null)
const edgeInspectorOpen = ref(true)

watch(
  selectedEdgeIds,
  (ids) => {
    if (!ids?.length) {
      focusedEdgeId.value = null
    } else if (focusedEdgeId.value === null || !ids.includes(focusedEdgeId.value)) {
      focusedEdgeId.value = ids[0]
    }
  },
  { immediate: true },
)

const { data: edgeData, loading: edgeLoading, error: edgeError } =
  useEdgeInspect(graphId, focusedEdgeId)

const edgeQueueIds = computed(() => (selectedEdgeIds.value || []).slice(0, MAX_QUEUE))
const edgeQueueOverflow = computed(() =>
  Math.max(0, (selectedEdgeIds.value?.length ?? 0) - MAX_QUEUE))

const edgeAttrEntries = computed(() => {
  const obj = edgeData.value?.attributes ?? {}
  const isWeighted = Boolean(schema.value?.weighted)
  return Object.entries(obj)
    .filter(([k]) => isWeighted || k !== 'weight')
    .map(([k, v]) => ({ k, v }))
})
</script>

<template>
  <div v-if="schema" class="rounded-md border border-slate-200 bg-white px-3 py-2 flex flex-col gap-1">
    <!-- Graph name -->
    <div class="flex items-baseline gap-2">
      <span class="text-sm font-semibold text-primary leading-tight truncate">{{ schema.name ?? 'Graph' }}</span>
    </div>

    <!-- Structural flags -->
    <p class="text-[10px] text-secondary">
      <span v-for="(f, i) in structuralFlags" :key="f">
        <template v-if="i > 0"> · </template>{{ f }}
      </span>
    </p>

    <!-- Counts -->
    <div class="mt-1 flex flex-col gap-0.5 text-xs">
      <div class="flex items-baseline justify-between">
        <span class="text-[10px] uppercase tracking-wide text-secondary">Nodes</span>
        <span class="tabular-nums">
          <strong class="text-primary">{{ filteredNodeCount.toLocaleString() }}</strong>
          <span class="text-secondary"> / {{ schema.nodes.toLocaleString() }}</span>
        </span>
      </div>
      <div class="flex items-baseline justify-between">
        <span class="text-[10px] uppercase tracking-wide text-secondary">Edges</span>
        <span class="tabular-nums">
          <strong class="text-primary">{{ filteredEdgeCount.toLocaleString() }}</strong>
          <span class="text-secondary"> / {{ schema.edges.toLocaleString() }}</span>
        </span>
      </div>
    </div>

    <!-- Auto-promotion caption -->
    <p v-if="promotionCaption" class="mt-1 inline-flex items-center gap-1 rounded-full bg-sky-50 px-2 py-0.5 text-[10px] font-medium text-sky-700 self-start">
      {{ promotionCaption }} <span class="opacity-60">(auto)</span>
    </p>

    <!-- Empty-state warning -->
    <p v-if="noNodesActive" class="mt-1 text-[10px] font-medium text-red-500">
      0 nodes match current filters
    </p>

    <!-- Node inspector — only when something is selected. -->
    <div v-if="selectedIds.length" class="mt-2 border-t border-slate-200 pt-2">
      <button
        class="flex w-full items-center gap-1 text-[10px] font-semibold uppercase tracking-wider text-secondary hover:text-primary"
        @click="inspectorOpen = !inspectorOpen">
        <component :is="inspectorOpen ? ChevronDown : ChevronRight" :size="11" />
        <span>Selected node</span>
        <span v-if="selectedIds.length > 1" class="ml-1 font-normal normal-case text-muted">
          (1 of {{ selectedIds.length }})
        </span>
        <button
          class="ml-auto rounded p-0.5 text-secondary transition hover:text-red-500"
          title="Clear selection"
          @click.stop="selection.clear()">
          <X :size="11" />
        </button>
      </button>

      <div v-if="inspectorOpen" class="mt-1.5 flex flex-col gap-2">
        <!-- Selection queue (only when more than one) -->
        <div v-if="selectedIds.length > 1" class="flex flex-wrap items-center gap-1">
          <button
            v-for="id in queueIds" :key="id"
            class="inline-flex items-center rounded-full border border-slate-300 bg-white px-1.5 py-0.5 text-[10px] transition hover:border-slate-500"
            :class="id === focusedId ? 'ring-1 ring-slate-900' : ''"
            @click="promoteNode(id)">
            <span class="max-w-[110px] truncate">{{ id }}</span>
          </button>
          <span v-if="queueOverflow > 0" class="text-[10px] text-muted">+{{ queueOverflow }}</span>
        </div>

        <!-- Loading / error -->
        <p v-if="inspectLoading" class="text-[10px] text-muted">Loading…</p>
        <p v-else-if="inspectError" class="text-[10px] text-red-600">
          {{ inspectError.message || 'Failed to load node details.' }}
        </p>

        <!-- Inspector card -->
        <div v-else-if="inspectData" class="flex flex-col gap-2 text-xs">
          <div v-if="showNodeTypeChip" class="flex items-center gap-2">
            <span
              class="inline-flex items-center rounded-full px-2 py-0.5 text-[10px] font-semibold text-white"
              :style="{ backgroundColor: typeColor(effectiveTypeLabel) }">
              {{ effectiveTypeLabel }}
            </span>
          </div>
          <div class="flex items-center gap-1 text-[11px] text-primary">
            <Hash :size="11" class="text-secondary" />
            <span class="font-medium break-all">{{ inspectData.id }}</span>
          </div>

          <!-- Structural counters; on directed graphs they're also toggle filters
               for the Neighbors list below ('all' / 'in' / 'out'). -->
          <div class="grid gap-1" :class="isDirected ? 'grid-cols-3' : 'grid-cols-1'">
            <button
              type="button"
              class="rounded-md border bg-white px-2 py-1 text-left transition"
              :class="isDirected
                ? (neighborFilter === 'all'
                  ? 'border-slate-900 ring-1 ring-slate-900'
                  : 'border-slate-200 hover:border-slate-400')
                : 'border-slate-200 cursor-default'"
              :disabled="!isDirected"
              :title="isDirected ? 'Show all neighbors' : ''"
              @click="isDirected && toggleNeighborFilter('all')">
              <div class="text-[9px] uppercase tracking-wider text-secondary">Deg</div>
              <div class="text-xs font-semibold tabular-nums">{{ inspectData.structural.degree }}</div>
            </button>
            <button
              v-if="isDirected"
              type="button"
              class="rounded-md border bg-white px-2 py-1 text-left transition"
              :class="neighborFilter === 'in'
                ? 'border-slate-900 ring-1 ring-slate-900'
                : 'border-slate-200 hover:border-slate-400'"
              title="Filter neighbors: incoming only"
              @click="toggleNeighborFilter('in')">
              <div class="flex items-center gap-1 text-[9px] uppercase tracking-wider text-secondary">
                <ArrowRightToLine :size="9" /> In
              </div>
              <div class="text-xs font-semibold tabular-nums">{{ inspectData.structural.in_degree ?? '—' }}</div>
            </button>
            <button
              v-if="isDirected"
              type="button"
              class="rounded-md border bg-white px-2 py-1 text-left transition"
              :class="neighborFilter === 'out'
                ? 'border-slate-900 ring-1 ring-slate-900'
                : 'border-slate-200 hover:border-slate-400'"
              title="Filter neighbors: outgoing only"
              @click="toggleNeighborFilter('out')">
              <div class="flex items-center gap-1 text-[9px] uppercase tracking-wider text-secondary">
                <ArrowRightFromLine :size="9" /> Out
              </div>
              <div class="text-xs font-semibold tabular-nums">{{ inspectData.structural.out_degree ?? '—' }}</div>
            </button>
          </div>

          <!-- Attributes -->
          <section v-if="attrEntries.length">
            <h4 class="text-[10px] font-semibold uppercase tracking-wider text-secondary mb-0.5">Attributes</h4>
            <dl class="grid grid-cols-[auto_1fr] gap-x-2 gap-y-0.5">
              <template v-for="entry in attrEntries" :key="entry.k">
                <dt class="text-[10px] uppercase tracking-wider text-secondary">{{ entry.k }}</dt>
                <dd class="text-[11px] text-slate-900 break-all">{{ formatValue(entry.v) }}</dd>
              </template>
            </dl>
          </section>

          <!-- Neighbors -->
          <section v-if="neighborTotal > 0">
            <h4 class="flex items-center justify-between text-[10px] font-semibold uppercase tracking-wider text-secondary mb-0.5">
              <span>Neighbors</span>
              <span class="font-normal normal-case text-[10px] text-muted">
                {{ neighborFilteredTotal }} / {{ neighborTotal }}
              </span>
            </h4>
            <ul
              v-if="visibleNeighbors.length"
              ref="scrollContainer"
              class="flex flex-col divide-y divide-slate-100 rounded-md border border-slate-200 bg-white"
              :class="neighborsExpanded ? 'max-h-72 overflow-y-auto scrollbar-slim' : ''"
              @scroll="neighborsExpanded ? onNeighborsScroll($event) : null">
              <li v-for="(n, i) in visibleNeighbors" :key="i"
                  class="flex items-center gap-1.5 px-1.5 py-1">
                <button
                  v-if="n.edge_id !== undefined"
                  class="text-secondary transition hover:text-primary shrink-0"
                  :title="`Inspect edge #${n.edge_id} (${n.edge_type})`"
                  @click="selection.replaceEdges([n.edge_id])">
                  <component :is="isDirected
                    ? (n.direction === 'out' ? ArrowRightFromLine : ArrowRightToLine)
                    : ArrowLeftRight"
                    :size="11" />
                </button>
                <component v-else :is="isDirected
                  ? (n.direction === 'out' ? ArrowRightFromLine : ArrowRightToLine)
                  : ArrowLeftRight"
                  :size="10"
                  class="text-secondary shrink-0" />
                <button
                  class="text-[10px] text-slate-900 hover:underline truncate"
                  :title="n.id"
                  @click="selection.replace([n.id])">
                  {{ n.id }}<span v-if="n.degree !== undefined" class="text-muted">
                    ({{ isDirected
                      ? `in ${n.in_degree} / out ${n.out_degree} / deg ${n.degree}`
                      : `deg ${n.degree}` }})
                  </span>
                </button>
                <span
                  v-if="showNodeTypeChip"
                  class="ml-auto inline-flex shrink-0 items-center rounded-full px-1.5 py-0.5 text-[9px] font-medium text-white"
                  :style="{ backgroundColor: typeColor(n.type) }">
                  {{ n.type }}
                </span>
              </li>
            </ul>
            <p v-else-if="!neighborsLoading" class="text-[10px] italic text-muted">
              No neighbors match the current filter.
            </p>
            <p v-if="neighborsLoading && neighborsExpanded" class="mt-1 text-[10px] italic text-muted">
              Loading more…
            </p>
            <button
              v-if="neighborOverflow > 0"
              class="mt-1 w-full rounded-md border border-slate-200 bg-slate-50 py-0.5 text-[10px] text-secondary transition hover:text-primary hover:border-slate-400"
              @click="neighborsExpanded = !neighborsExpanded">
              {{ neighborsExpanded ? 'Show less' : `Show all (${neighborFilteredTotal})` }}
            </button>
          </section>
        </div>
      </div>
    </div>

    <!-- Edge inspector — only when an edge is selected. -->
    <div v-if="selectedEdgeIds.length" class="mt-2 border-t border-slate-200 pt-2">
      <button
        class="flex w-full items-center gap-1 text-[10px] font-semibold uppercase tracking-wider text-secondary hover:text-primary"
        @click="edgeInspectorOpen = !edgeInspectorOpen">
        <component :is="edgeInspectorOpen ? ChevronDown : ChevronRight" :size="11" />
        <span>Selected edge</span>
        <span v-if="selectedEdgeIds.length > 1" class="ml-1 font-normal normal-case text-muted">
          (1 of {{ selectedEdgeIds.length }})
        </span>
        <button
          class="ml-auto rounded p-0.5 text-secondary transition hover:text-red-500"
          title="Clear edge selection"
          @click.stop="selection.clearEdges()">
          <X :size="11" />
        </button>
      </button>

      <div v-if="edgeInspectorOpen" class="mt-1.5 flex flex-col gap-2">
        <div v-if="selectedEdgeIds.length > 1" class="flex flex-wrap items-center gap-1">
          <button
            v-for="id in edgeQueueIds" :key="id"
            class="inline-flex items-center rounded-full border border-slate-300 bg-white px-1.5 py-0.5 text-[10px] transition hover:border-slate-500"
            :class="id === focusedEdgeId ? 'ring-1 ring-slate-900' : ''"
            @click="promoteEdge(id)">
            <span class="font-mono">#{{ id }}</span>
          </button>
          <span v-if="edgeQueueOverflow > 0" class="text-[10px] text-muted">+{{ edgeQueueOverflow }}</span>
        </div>

        <p v-if="edgeLoading" class="text-[10px] text-muted">Loading…</p>
        <p v-else-if="edgeError" class="text-[10px] text-red-600">
          {{ edgeError.message || 'Failed to load edge details.' }}
        </p>

        <div v-else-if="edgeData" class="flex flex-col gap-2 text-xs">
          <div class="flex items-center gap-2">
            <span
              v-if="showEdgeTypeChip"
              class="inline-flex items-center rounded-full bg-slate-900 px-2 py-0.5 text-[10px] font-semibold text-white">
              {{ edgeData.edge_type }}
            </span>
            <span class="font-mono text-[10px] text-muted">#{{ edgeData.edge_id }}</span>
          </div>

          <!-- Source → Target -->
          <div class="flex items-center gap-1.5 text-[11px] text-primary">
            <button
              class="inline-flex items-center gap-1 rounded-md border border-slate-200 bg-white px-1.5 py-0.5 hover:border-slate-500"
              :title="`Inspect node ${edgeData.source.id}`"
              @click="selection.replace([edgeData.source.id])">
              <span
                v-if="showNodeTypeChip"
                class="inline-block h-2 w-2 rounded-full"
                :style="{ backgroundColor: typeColor(edgeData.source.type) }" />
              <span class="truncate max-w-[100px]">{{ edgeData.source.id }}</span>
            </button>
            <component :is="edgeData.directed ? ArrowRight : ArrowLeftRight"
                       :size="11" class="text-secondary shrink-0" />
            <button
              class="inline-flex items-center gap-1 rounded-md border border-slate-200 bg-white px-1.5 py-0.5 hover:border-slate-500"
              :title="`Inspect node ${edgeData.target.id}`"
              @click="selection.replace([edgeData.target.id])">
              <span
                v-if="showNodeTypeChip"
                class="inline-block h-2 w-2 rounded-full"
                :style="{ backgroundColor: typeColor(edgeData.target.type) }" />
              <span class="truncate max-w-[100px]">{{ edgeData.target.id }}</span>
            </button>
          </div>

          <!-- Attributes -->
          <section v-if="edgeAttrEntries.length">
            <h4 class="text-[10px] font-semibold uppercase tracking-wider text-secondary mb-0.5">Attributes</h4>
            <dl class="grid grid-cols-[auto_1fr] gap-x-2 gap-y-0.5">
              <template v-for="entry in edgeAttrEntries" :key="entry.k">
                <dt class="text-[10px] uppercase tracking-wider text-secondary">{{ entry.k }}</dt>
                <dd class="text-[11px] text-slate-900 break-all">{{ formatValue(entry.v) }}</dd>
              </template>
            </dl>
          </section>
          <p v-else class="text-[10px] italic text-muted">No additional attributes.</p>
        </div>
      </div>
    </div>
  </div>
</template>
