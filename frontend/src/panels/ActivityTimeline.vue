<script setup>
import { ref, computed, toRef, watch, nextTick } from 'vue'
import * as d3 from 'd3'
import { Clock, Settings } from 'lucide-vue-next'

import { useTimeline } from '@/composables/useTimeline.js'
import { useNodeTypeColors } from '@/composables/useNodeTypeColors.js'
import { useEdgeTypeColors } from '@/composables/useEdgeTypeColors.js'
import { useFiltersStore } from '@/stores/filters.js'
import { useEffectiveType } from '@/composables/useEffectiveType.js'
import { usePanelContextFromProps } from '@/composables/usePanelContext.js'
import { useTimelineSettingsModal } from '@/composables/useTimelineSettingsModal.js'
import { usePanel } from './usePanel.js'
import { useD3Chart } from './useD3Chart.js'
import { makeTooltip, showTip, hideTip, svgFrame, FORMATTERS } from './shared.js'
import ControlSection from './controls/ControlSection.vue'
import ControlToggleGroup from './controls/ControlToggleGroup.vue'

const props = defineProps({
  panelSpec: { type: Object, required: true },
  schema: { type: Object, default: null },
  graphId: { type: String, default: null },
  widened: { type: Boolean, default: false },
  expanded: { type: Boolean, default: false },
  controlsTarget: { type: String, default: null },
  theoryTarget: { type: String, default: null },
  mode: { type: String, default: 'node' },  // 'node' | 'edge'
})

defineEmits(['request-widen', 'request-shrink'])

const THEORY_LINK = 'underline underline-offset-2 font-medium text-sky-700 hover:text-sky-900 cursor-pointer'
const THEORY_LINK_ON = 'no-underline font-medium text-sky-700 bg-sky-100 rounded px-1 cursor-pointer'
function theoryLinkClass(on) { return on ? THEORY_LINK_ON : THEORY_LINK }

const { data, loading, error } = useTimeline(toRef(props, 'graphId'))
const { color: nodeTypeColor } = useNodeTypeColors(toRef(props, 'schema'))
const { color: edgeTypeColor } = useEdgeTypeColors(toRef(props, 'schema'))
// Shared, effective-type-aware mapping on both sides — same hue per type across all panels.
const typeColor = (t) => props.mode === 'edge' ? edgeTypeColor(t) : nodeTypeColor(t)
const filters = useFiltersStore()
const { nodeTypeAt, edgeTypeAt } = useEffectiveType(toRef(props, 'graphId'), toRef(props, 'schema'))
const { activeNodeMask, activeEdgeMask } = usePanelContextFromProps(props)
// The mask this scope reacts to: node-scope timelines mask on nodes, edge-scope on edges.
const scopeMask = computed(() => props.mode === 'edge' ? activeEdgeMask.value : activeNodeMask.value)
const typeAt = (idx) => props.mode === 'edge' ? edgeTypeAt(idx) : nodeTypeAt(idx)
const { openTimelineSettings } = useTimelineSettingsModal()
const { controls, updateControl } = usePanel(props, null, data)

const chartContainer = ref(null)
let tooltip = null

const MARGINS = { top: 12, right: 16, bottom: 34, left: 50 }

const BREAKDOWN_OPTIONS = [
  { k: 'type', label: 'By Type' },
  { k: 'none', label: 'None' },
]
const BIN_OPTIONS = [
  { k: 'year', label: 'Year' },
  { k: 'decade', label: 'Decade' },
]

const temporalAttrs = computed(() => {
  const d = data.value
  if (!d) return []
  return props.mode === 'edge' ? (d.temporal_attrs_edge ?? []) : (d.temporal_attrs_node ?? [])
})
const perAttr = computed(() => {
  const d = data.value
  if (!d) return {}
  return props.mode === 'edge' ? (d.per_attr_edge ?? {}) : (d.per_attr_node ?? {})
})

const activeAttr = computed(() => {
  const list = temporalAttrs.value
  if (controls.value.attr && list.includes(controls.value.attr)) return controls.value.attr
  return list[0] || null
})
const activeAttrData = computed(() => activeAttr.value ? perAttr.value[activeAttr.value] : null)
const activeBins = computed(() => {
  const a = activeAttrData.value
  if (!a) return []
  return controls.value.binSize === 'decade' ? (a.bins_decade || []) : (a.bins || [])
})

const isEmpty = computed(() => !loading.value && data.value && temporalAttrs.value.length === 0)
const isNoValid = computed(() => !loading.value && activeAttrData.value && activeAttrData.value.valid_count === 0)

const recordLabel = computed(() => props.mode === 'edge' ? 'edges' : 'nodes')
const typeLabel = computed(() => props.mode === 'edge' ? 'edge type' : 'node type')
const coverageText = computed(() => {
  const a = activeAttrData.value
  if (!a) return ''
  const pct = a.eligible_records ? ((a.valid_count / a.eligible_records) * 100).toFixed(0) : '?'
  return `${a.valid_count.toLocaleString()} / ${a.eligible_records.toLocaleString()} valid (${pct}%) · strategy: ${a.parse_strategy} · failures: ${a.parse_failures}`
})
const coverageTooltipText = computed(() => {
  const a = activeAttrData.value
  if (!a) return ''
  return `Of ${a.total_records.toLocaleString()} total ${recordLabel.value}, ${a.eligible_records.toLocaleString()} carry this attribute; ${a.valid_count.toLocaleString()} parsed via ${a.parse_strategy}; ${a.parse_failures.toLocaleString()} unparseable values discarded.`
})

function render() {
  if (!chartContainer.value) return
  d3.select(chartContainer.value).selectAll('*').remove()
  if (!data.value || !activeAttrData.value || activeBins.value.length === 0) return

  const bins = activeBins.value
  const { totalW, totalH, innerW, innerH } = svgFrame(chartContainer.value, MARGINS, { minInner: 50 })

  const svg = d3.select(chartContainer.value).append('svg')
    .attr('width', totalW).attr('height', totalH)
  if (!tooltip) tooltip = makeTooltip(chartContainer.value)

  const g = svg.append('g').attr('transform', `translate(${MARGINS.left},${MARGINS.top})`)

  // Mask-only contract: each bin carries `idx` (canonical SoA indices of its
  // records). The ACTIVE height counts only indices in the global mask; the
  // full-graph `total` is drawn behind as a grey baseline silhouette so the
  // user sees what every filter (not just types) hid — same idiom as
  // DegreeDistribution. No raw filters.* read here.
  const mask = scopeMask.value
  const active = computeActiveBins(bins, mask)            // [{year, total, activeTotal, activeByType}]
  const activeTypes = activeTypeList(active)

  const xScale = d3.scaleBand().domain(bins.map(b => b.year)).range([0, innerW]).padding(0.1)
  const maxTotal = d3.max(bins, b => b.total) || 1
  const yScale = d3.scaleLinear().domain([0, maxTotal]).range([innerH, 0])

  const maxXTicks = 10
  const step = Math.max(1, Math.ceil(bins.length / maxXTicks))
  const tickValues = bins.map(b => b.year).filter((_, i) => i % step === 0)
  g.append('g').attr('transform', `translate(0,${innerH})`)
    .call(d3.axisBottom(xScale).tickValues(tickValues).tickFormat(d => String(d)))
    .selectAll('text').attr('font-size', 10).attr('fill', '#64748b')

  g.append('g').call(d3.axisLeft(yScale).ticks(5).tickFormat(FORMATTERS.siCompact))
    .selectAll('text').attr('font-size', 10).attr('fill', '#64748b')

  svg.append('text')
    .attr('x', MARGINS.left + innerW / 2)
    .attr('y', totalH - 4)
    .attr('text-anchor', 'middle').attr('font-size', 11).attr('fill', '#475569')
    .text(activeAttr.value)

  // Baseline silhouette: the full-graph bin, drawn only where the filter hides
  // part of it (activeTotal < total). Skipped entirely when no filter is active.
  const filterActive = active.some(a => a.activeTotal < a.total)
  if (filterActive) {
    g.selectAll('rect.baseline').data(active).join('rect').attr('class', 'baseline')
      .attr('x', d => xScale(d.year))
      .attr('y', d => yScale(d.total))
      .attr('width', xScale.bandwidth())
      .attr('height', d => innerH - yScale(d.total))
      .attr('fill', '#cbd5e1')
      .attr('opacity', 0.5)
  }

  if (controls.value.breakdown === 'type' && activeTypes.length > 0) {
    const rows = active.map(a => {
      const row = { year: a.year }
      for (const t of activeTypes) row[t] = a.activeByType.get(t) || 0
      return row
    })
    const series = d3.stack().keys(activeTypes)(rows)
    g.selectAll('g.layer').data(series).join('g').attr('class', 'layer')
      .attr('fill', d => typeColor(d.key))
      .selectAll('rect').data(d => d).join('rect')
      .attr('x', d => xScale(d.data.year))
      .attr('y', d => yScale(d[1]))
      .attr('height', d => yScale(d[0]) - yScale(d[1]))
      .attr('width', xScale.bandwidth())
      .attr('opacity', 0.9)
      .style('cursor', 'pointer')
      .on('mouseover', (ev, d) => showTip(tooltip, ev, binTooltip(d.data.year)))
      .on('mousemove', (ev) => showTip(tooltip, ev, null))
      .on('mouseout', () => hideTip(tooltip))
      .on('click', (_, d) => onBarClick(d.data.year))
  } else {
    g.selectAll('rect.bar').data(active).join('rect').attr('class', 'bar')
      .attr('x', d => xScale(d.year))
      .attr('y', d => yScale(d.activeTotal))
      .attr('width', xScale.bandwidth())
      .attr('height', d => innerH - yScale(d.activeTotal))
      .attr('fill', '#0284c7')
      .attr('opacity', 0.9)
      .style('cursor', 'pointer')
      .on('mouseover', (ev, d) => showTip(tooltip, ev, binTooltip(d.year)))
      .on('mousemove', (ev) => showTip(tooltip, ev, null))
      .on('mouseout', () => hideTip(tooltip))
      .on('click', (_, d) => onBarClick(d.year))
  }

  const brush = d3.brushX()
    .extent([[0, 0], [innerW, innerH]])
    .on('end', (event) => {
      if (!event.selection) {
        filters.temporalFilter = null
        return
      }
      const [x0, x1] = event.selection
      const yearsInRange = bins
        .filter(b => {
          const left = xScale(b.year)
          const right = left + xScale.bandwidth()
          return right >= x0 && left <= x1
        })
        .map(b => b.year)
      if (!yearsInRange.length) {
        filters.temporalFilter = null
        return
      }
      const lo = yearsInRange[0]
      const hi = yearsInRange[yearsInRange.length - 1]
      filters.temporalFilter = { attr: activeAttr.value, scope: props.mode, range: [lo, hi] }
    })

  g.append('g').attr('class', 'brush').call(brush)
}

// Mask-only aggregation: count each bin's records that survive the global mask,
// grouped by effective type. The mask already encodes every filter (types,
// degree, weight, wcc, attrs, …), so the panel reacts to all of them — not just
// the type chip group. No raw filters.* read.
function computeActiveBins(bins, mask) {
  return bins.map(b => {
    const idx = b.idx || []
    const activeByType = new Map()
    let activeTotal = 0
    for (const i of idx) {
      // No mask yet (initial paint) → treat all as active so bars aren't empty.
      if (mask && !mask.get(i)) continue
      activeTotal += 1
      const t = typeAt(i)
      activeByType.set(t, (activeByType.get(t) || 0) + 1)
    }
    return { year: b.year, total: b.total, activeTotal, activeByType }
  })
}

function activeTypeList(active) {
  const seen = new Set()
  for (const a of active) for (const t of a.activeByType.keys()) seen.add(t)
  return [...seen].sort()
}

function binTooltip(year) {
  const mask = scopeMask.value
  const b = activeBins.value.find(x => x.year === year)
  if (!b) return `<b>${year}</b>`
  const idx = b.idx || []
  let activeTotal = 0
  const byType = new Map()
  for (const i of idx) {
    if (mask && !mask.get(i)) continue
    activeTotal += 1
    const t = typeAt(i)
    byType.set(t, (byType.get(t) || 0) + 1)
  }
  const head = activeTotal < b.total
    ? `<b>${year}</b>: ${activeTotal.toLocaleString()} / ${b.total.toLocaleString()}`
    : `<b>${year}</b>: ${b.total.toLocaleString()}`
  const lines = [head]
  for (const [t, c] of [...byType.entries()].sort((a, c) => c[1] - a[1])) {
    lines.push(`<span style="color:${typeColor(t)}">●</span> ${t}: ${c.toLocaleString()}`)
  }
  return lines.join('<br>')
}

function onBarClick(year) {
  filters.temporalFilter = { attr: activeAttr.value, scope: props.mode, range: [year, year] }
}

watch([data, controls, () => props.widened, scopeMask, () => props.mode], () => nextTick(render), { deep: true })

useD3Chart(chartContainer, render, () => [props.widened, props.expanded])
</script>

<template>
  <div class="flex flex-col gap-1.5">
    <Teleport v-if="theoryTarget" :to="`#${theoryTarget}`">
      <div class="flex flex-col gap-4 text-sm leading-relaxed text-secondary">

        <!-- Attribute switcher: only when the graph has ≥2 temporal attributes
             (otherwise there's nothing to switch between). -->
        <section v-if="temporalAttrs.length > 1" class="flex flex-col gap-2">
          <h3 class="text-xs font-semibold uppercase tracking-widest text-muted">Temporal attribute</h3>
          <p>
            This graph has several time fields. Plot:
          </p>
          <select
            class="input-base text-xs px-2 py-1 w-full"
            :value="activeAttr ?? ''"
            @change="(e) => updateControl('attr', e.target.value)"
          >
            <option v-for="a in temporalAttrs" :key="a" :value="a">{{ a }}</option>
          </select>
        </section>

        <section class="flex flex-col gap-2">
          <h3 class="text-xs font-semibold uppercase tracking-widest text-muted">Reading this timeline</h3>
          <p>
            Each bar is a time bin — a <strong>year</strong> or a <strong>decade</strong>. Its height is
            how many <strong>{{ recordLabel }}</strong> carry a date in that period, for the chosen
            temporal attribute. The faint grey silhouette behind the bars is the <strong>full-graph
            total</strong>; the colored bars in front are what survives the current filter, so you read
            the filter's effect as the gap between the two.
          </p>
        </section>

        <section class="flex flex-col gap-2">
          <h3 class="text-xs font-semibold uppercase tracking-widest text-muted">Bins &amp; breakdown</h3>
          <p>
            Switch the bin to
            <button :class="theoryLinkClass(controls.binSize === 'year')"
              @click="updateControl('binSize', 'year')">year</button>
            for detail or
            <button :class="theoryLinkClass(controls.binSize === 'decade')"
              @click="updateControl('binSize', 'decade')">decade</button>
            to smooth a sparse, long history. Stack the bars
            <button :class="theoryLinkClass(controls.breakdown === 'type')"
              @click="updateControl('breakdown', 'type')">by {{ typeLabel }}</button>
            to see which kinds dominate each period (colors match every other panel), or collapse to a
            <button :class="theoryLinkClass(controls.breakdown === 'none')"
              @click="updateControl('breakdown', 'none')">single series</button>
            for the plain volume curve.
          </p>
        </section>

        <section class="flex flex-col gap-2">
          <h3 class="text-xs font-semibold uppercase tracking-widest text-muted">Dates are messy</h3>
          <p>
            Knowledge-graph dates arrive as free-form strings (<code>1998</code>, <code>1998-03</code>,
            <code>March 1998</code>, epoch seconds…). We parse them with a per-attribute
            <strong>strategy</strong> and report honest <strong>coverage</strong>: how many values parsed
            and how many were dropped. If the curve looks wrong, the strategy is usually the cause —
            <button :class="THEORY_LINK" @click="openTimelineSettings()">open date-parsing settings</button>
            to change it. Bars are computed only from values that parsed; unparseable ones are excluded,
            not guessed.
          </p>
        </section>

        <section class="flex flex-col gap-2">
          <h3 class="text-xs font-semibold uppercase tracking-widest text-muted">Brushing to a period</h3>
          <p>
            Drag across the bars to select a span, or click a single bar for one bin — either writes a
            <strong>temporal filter</strong> ({{ recordLabel }} scope) that the rest of the dashboard
            reacts to. It's the time equivalent of brushing in any linked view: narrow the era here,
            read its structure everywhere else.
          </p>
        </section>

      </div>
    </Teleport>

    <Teleport v-if="controlsTarget && temporalAttrs.length" :to="`#${controlsTarget}`">
      <div class="grid grid-cols-2 auto-rows-min gap-1.5">
        <ControlSection title="Breakdown">
          <ControlToggleGroup
            :model-value="controls.breakdown"
            :options="BREAKDOWN_OPTIONS"
            @update:model-value="updateControl('breakdown', $event)"
          />
        </ControlSection>

        <ControlSection title="Bin size">
          <ControlToggleGroup
            :model-value="controls.binSize"
            :options="BIN_OPTIONS"
            @update:model-value="updateControl('binSize', $event)"
          />
        </ControlSection>

        <ControlSection title="Parsing" :col-span="2">
          <button class="inline-flex items-center gap-1 text-[11px] text-sky-600 hover:underline"
                  @click="openTimelineSettings">
            <Settings :size="12" />
            Customize date parsing…
          </button>
          <p v-if="activeAttrData" class="text-[10px] text-muted mt-1">
            Strategy: <code>{{ activeAttrData.parse_strategy }}</code> · {{ activeAttrData.parse_failures }} failures
          </p>
        </ControlSection>
      </div>
    </Teleport>

    <div v-if="loading" class="text-sm text-secondary p-3 surface-recessed rounded-lg">Loading timeline…</div>
    <div v-if="error" class="text-sm text-red-600 p-3 bg-red-50 rounded-lg border border-red-200">{{ error }}</div>

    <div v-if="!loading && !error" class="flex flex-col gap-1">
      <div
        v-if="isEmpty"
        class="flex flex-col items-center justify-center gap-2 surface-recessed rounded-lg p-6 text-sm text-secondary"
        style="aspect-ratio: 4/3;"
      >
        <Clock :size="36" class="text-muted" />
        <p class="text-center">No temporal data in this graph.</p>
      </div>

      <div
        v-else-if="isNoValid"
        class="flex flex-col items-center justify-center gap-2 surface-recessed rounded-lg p-6 text-sm text-secondary"
        style="aspect-ratio: 4/3;"
      >
        <Clock :size="36" class="text-muted" />
        <p class="text-center">No parseable values for <code>{{ activeAttr }}</code> (strategy: <code>{{ activeAttrData?.parse_strategy }}</code>).</p>
        <button class="text-[11px] text-sky-600 hover:underline" @click="openTimelineSettings()">Open settings to adjust…</button>
      </div>

      <template v-else>
        <p v-if="activeAttrData" class="text-[10px] text-muted leading-tight" :title="coverageTooltipText">
          {{ coverageText }}
        </p>
        <div ref="chartContainer" class="chart-elev w-full min-w-0" style="aspect-ratio: 4/3; position: relative;"></div>
        <p class="text-[10px] leading-tight text-muted px-1">
          Bins parsed on the full graph; current filter hides type segments (and rescales totals accordingly).
        </p>
      </template>
    </div>
  </div>
</template>
