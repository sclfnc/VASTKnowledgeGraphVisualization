<script setup>
// Per-type attribute schema; parametric over mode ('node' | 'edge').
// HTML-only (no D3) — small bounded matrix; native scrolling + tooltips for free.
import { computed, toRef } from 'vue'
import { useNodeTypeColors } from '@/composables/useNodeTypeColors.js'
import { useFiltersStore } from '@/stores/filters.js'
import { formatAttrSummary, formatCoverage } from './shared.js'
import { usePanel } from './usePanel.js'
import ControlSection from './controls/ControlSection.vue'
import ControlSwitch from './controls/ControlSwitch.vue'
import ControlToggleGroup from './controls/ControlToggleGroup.vue'

const props = defineProps({
  panelSpec:      { type: Object, required: true },
  schema:         { type: Object, default: null },
  graphId:        { type: String, default: null },
  widened:        { type: Boolean, default: false },
  controlsTarget: { type: String, default: null },
  mode:           { type: String, default: 'node', validator: v => ['node', 'edge'].includes(v) },
})

const { controls, updateControl } = usePanel(props, props.panelSpec?.id ?? 'node_attrs')
const { color: typeColor } = useNodeTypeColors(toRef(props, 'schema'))
const filters = useFiltersStore()

// Full per-type schema; coverage stays anchored to the unmasked graph.
const typesDetail = computed(() => {
  const key = props.mode === 'edge' ? 'edge_types_detail' : 'node_types_detail'
  return props.schema?.[key] ?? []
})

// Hidden types disappear from rows/breakdowns; coverage numbers are not recomputed.
const visibleTypeNames = computed(() => {
  const list = props.mode === 'edge' ? filters.edgeTypes : filters.nodeTypes
  return new Set(list ?? [])
})

const visibleTypesDetail = computed(() =>
  typesDetail.value.filter(t => visibleTypeNames.value.has(t.name))
)

// Empty-state branches: schema has no attrs (MC1 edges) vs. user filtered every type out.
const hasAnyAttr = computed(() => typesDetail.value.some(t => t.attributes.length > 0))
const noVisibleType = computed(() => visibleTypesDetail.value.length === 0)

// Built from the full schema so `Shared` highlights reflect topology, not UI state.
const attrUnion = computed(() => {
  const map = new Map()
  for (const t of typesDetail.value) {
    for (const a of t.attributes) {
      let entry = map.get(a.name)
      if (!entry) {
        entry = { name: a.name, kind: a.kind, perType: [] }
        map.set(a.name, entry)
      }
      entry.perType.push({ type: t.name, count: t.count, attr: a })
    }
  }
  return [...map.values()].sort((a, b) => a.name.localeCompare(b.name))
})

// Keep attr if SOME type covers it ≥ threshold; Attribute-first further drops zero-visible attrs.
const filteredAttrs = computed(() => {
  const thr = controls.value.minCoverage ?? 0
  if (thr <= 0) return attrUnion.value
  return attrUnion.value.filter(a => a.perType.some(p => p.attr.coverage >= thr))
})

// Per-attribute coverages restricted to visible types; drops attrs left empty.
const visibleAttrEntries = computed(() => {
  const v = visibleTypeNames.value
  return filteredAttrs.value
    .map(a => ({ ...a, perTypeVisible: a.perType.filter(p => v.has(p.type)) }))
    .filter(a => a.perTypeVisible.length > 0)
})

function coverageOf(typeName, attrName) {
  const t = typesDetail.value.find(t => t.name === typeName)
  return t?.attributes.find(a => a.name === attrName) ?? null
}

// Monochrome blue ramp by coverage: light at 0%, sky-700 at 100%.
function cellStyle(attr) {
  if (!attr) return { backgroundColor: '#f8fafc', color: '#cbd5e1' }
  const c = attr.coverage
  const lightness = 95 - Math.round(c * 55) // 95 → 40
  return { backgroundColor: `hsl(204, 80%, ${lightness}%)`, color: c > 0.5 ? '#fff' : '#1e293b' }
}

function cellTooltip(typeName, attrEntry) {
  if (!attrEntry) return `${typeName}: ${attrEntry?.name ?? ''} not present`
  return `${typeName}.${attrEntry.name} · ${attrEntry.kind} · ${formatCoverage(attrEntry.coverage)} · ${formatAttrSummary(attrEntry)}`
}

const VIEW_OPTIONS = [
  { k: 'matrix', label: 'Matrix' },
  { k: 'attribute', label: 'Attribute-first' },
]

const COVERAGE_OPTIONS = [
  { k: 0, label: 'All' },
  { k: 0.25, label: '≥25%' },
  { k: 0.5, label: '≥50%' },
  { k: 0.9, label: '≥90%' },
]

const labelEmpty = computed(() =>
  props.mode === 'edge'
    ? 'No additional edge attributes — all edges carry only Edge Type.'
    : 'No additional node attributes — every node carries only Node Type.'
)
</script>

<template>
  <div class="flex flex-col gap-2">
    <Teleport v-if="controlsTarget" :to="`#${controlsTarget}`">
      <div class="grid grid-cols-2 auto-rows-min gap-1.5">
        <ControlSection title="View">
          <ControlToggleGroup
            :model-value="controls.view"
            :options="VIEW_OPTIONS"
            @update:model-value="updateControl('view', $event)" />
        </ControlSection>

        <ControlSection title="Highlight">
          <ControlSwitch
            label="Shared attrs"
            :model-value="controls.highlightShared"
            @update:model-value="updateControl('highlightShared', $event)" />
        </ControlSection>

        <ControlSection title="Min coverage" :col-span="2">
          <ControlToggleGroup
            :model-value="controls.minCoverage"
            :options="COVERAGE_OPTIONS"
            @update:model-value="updateControl('minCoverage', $event)" />
        </ControlSection>
      </div>
    </Teleport>

    <div v-if="!hasAnyAttr" class="surface-recessed rounded-lg p-4 text-center text-sm text-secondary">
      {{ labelEmpty }}
    </div>

    <div v-else-if="noVisibleType" class="surface-recessed rounded-lg p-4 text-center text-sm text-secondary">
      All {{ mode === 'edge' ? 'edge' : 'node' }} types are hidden by the current filter.
    </div>

    <div v-else-if="controls.view === 'matrix'" class="overflow-x-auto">
      <table class="w-full border-separate text-[11px]" style="border-spacing: 2px;">
        <thead>
          <tr>
            <th class="sticky left-0 z-10 bg-white px-2 py-1 text-left text-[10px] font-semibold uppercase tracking-wide text-muted">
              Type
            </th>
            <th
              v-for="a in filteredAttrs" :key="a.name"
              class="px-2 py-1 text-left text-[10px] font-semibold text-secondary"
              :class="controls.highlightShared && a.perType.length > 1 ? 'bg-amber-50 ring-1 ring-amber-200 rounded' : ''"
              :title="`${a.name} · ${a.kind} · in ${a.perType.length} type${a.perType.length > 1 ? 's' : ''}`">
              <div class="flex flex-col leading-tight">
                <span class="font-bold text-primary">{{ a.name }}</span>
                <span class="text-[9px] uppercase tracking-wide text-muted">{{ a.kind }}</span>
              </div>
            </th>
          </tr>
        </thead>
        <tbody>
          <tr v-for="t in visibleTypesDetail" :key="t.name">
            <td class="sticky left-0 z-10 bg-white px-2 py-1">
              <div class="flex items-baseline gap-1.5">
                <span class="text-xs font-bold" :style="{ color: mode === 'node' ? typeColor(t.name) : '#0f172a' }">
                  {{ t.name }}
                </span>
                <span class="text-[10px] text-muted tabular-nums">{{ t.count.toLocaleString() }}</span>
              </div>
            </td>
            <td
              v-for="a in filteredAttrs" :key="a.name"
              class="px-2 py-1 text-center font-medium tabular-nums rounded cursor-default"
              :style="cellStyle(coverageOf(t.name, a.name))"
              :title="cellTooltip(t.name, coverageOf(t.name, a.name))">
              <template v-if="coverageOf(t.name, a.name)">
                {{ formatCoverage(coverageOf(t.name, a.name).coverage) }}
              </template>
              <span v-else class="opacity-50">·</span>
            </td>
          </tr>
        </tbody>
      </table>
    </div>

    <div v-else class="flex flex-col gap-3">
      <div
        v-for="a in visibleAttrEntries" :key="a.name"
        class="flex flex-col gap-1 rounded-lg p-2"
        :class="controls.highlightShared && a.perType.length > 1 ? 'bg-amber-50 ring-1 ring-amber-200' : 'surface-recessed'">
        <div class="flex items-baseline gap-2">
          <span class="text-sm font-bold text-primary">{{ a.name }}</span>
          <span class="text-[10px] uppercase tracking-wide text-muted">{{ a.kind }}</span>
          <span class="ml-auto text-[10px] text-muted">
            {{ a.perType.length }} type{{ a.perType.length > 1 ? 's' : '' }}
          </span>
        </div>
        <ul class="flex flex-col gap-0.5 pl-2 text-[11px]">
          <li v-for="p in a.perTypeVisible" :key="p.type" class="flex flex-wrap items-baseline gap-x-1.5">
            <span class="font-semibold" :style="{ color: mode === 'node' ? typeColor(p.type) : '#0f172a' }">
              {{ p.type }}
            </span>
            <span class="text-[10px] text-muted tabular-nums">{{ formatCoverage(p.attr.coverage) }}</span>
            <span class="truncate text-secondary" :title="formatAttrSummary(p.attr)">
              · {{ formatAttrSummary(p.attr) }}
            </span>
          </li>
        </ul>
      </div>
    </div>

    <p v-if="hasAnyAttr && !noVisibleType" class="text-[10px] leading-tight text-muted px-1">
      Coverage values computed on the full graph; current filter only hides {{ mode === 'edge' ? 'edge' : 'node' }} types.
    </p>
  </div>
</template>
