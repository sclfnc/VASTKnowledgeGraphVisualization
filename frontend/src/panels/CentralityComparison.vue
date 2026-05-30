<script setup>
// 4×4 scatter matrix on the four centralities; reads from the global poller.
// Three exclusive branches: error (names failed measures) → loading → ready.
import { ref, computed, toRef, watch, nextTick } from 'vue'
import * as d3 from 'd3'
import { useAllCentralities } from '@/composables/useAllCentralities.js'
import { useNodeTypeColors } from '@/composables/useNodeTypeColors.js'
import { useEffectiveType } from '@/composables/useEffectiveType.js'
import { usePanelContextFromProps } from '@/composables/usePanelContext.js'
import { useSelectionStore } from '@/stores/selection.js'
import { usePanel } from './usePanel.js'
import { useD3Chart } from './useD3Chart.js'
import { FORMATTERS, makeTooltip, showTip, hideTip, drawTypeLegend, pearson, spearman, svgFrame, ATTENUATED_OPACITY } from './shared.js'
import ControlSection from './controls/ControlSection.vue'
import ControlSwitch from './controls/ControlSwitch.vue'
import ControlToggleGroup from './controls/ControlToggleGroup.vue'

const props = defineProps({
  panelSpec: { type: Object, required: true },
  schema: { type: Object, default: null },
  graphId: { type: String, default: null },
  widened: { type: Boolean, default: false },
  controlsTarget: { type: String, default: null },
})

const all = useAllCentralities()
const { color: typeColor } = useNodeTypeColors(toRef(props, 'schema'))
const { nodeType: effNodeType } = useEffectiveType(toRef(props, 'graphId'), toRef(props, 'schema'))
const { activeNodeMask, isActive, isSelected, selectedMask, edgeFilterActive, noNodesActive } = usePanelContextFromProps(props)
const selection = useSelectionStore()
const { controls, updateControl } = usePanel(props, props.panelSpec?.id, null)
const chartContainer = ref(null)

const MEASURE_LABELS = {
  pagerank: 'PageRank',
  eigenvector: 'Eigenvector',
  betweenness: 'Betweenness',
  closeness: 'Closeness',
}
const MEASURE_KEYS = ['pagerank', 'eigenvector', 'betweenness', 'closeness']

const CORR_OPTIONS = [
  { k: 'spearman', label: 'Spearman' },
  { k: 'pearson', label: 'Pearson' },
]

// Use the undirected variant (always available, never degenerate); Out/In live in the single panel.
const closenessUndirected = computed(() => all.closeness.value?.undirected ?? null)

const branches = computed(() => {
  if (all.anyError.value || all.anyCancelled.value) return 'error'
  if (!all.allReady.value) return 'loading'
  return 'ready'
})

const matrix = computed(() => {
  if (branches.value !== 'ready') return null
  // Unified index: nodeId → {pr, ev, bw, cl, type}.
  const idx = new Map()
  const seed = (records, key) => {
    for (const r of records || []) {
      const cur = idx.get(r.id) || { id: r.id, type: r.type }
      cur[key] = r.value
      cur.type = cur.type || r.type
      idx.set(r.id, cur)
    }
  }
  seed(all.pagerank.value?.values, 'pagerank')
  seed(all.eigenvector.value?.values, 'eigenvector')
  seed(all.betweenness.value?.values, 'betweenness')
  seed(closenessUndirected.value?.values, 'closeness')
  // Only nodes with all four measures defined.
  return [...idx.values()].filter(r =>
    r.pagerank != null && r.eigenvector != null && r.betweenness != null && r.closeness != null
  )
})

const corrs = computed(() => {
  const m = matrix.value
  if (!m) return null
  const out = {}
  for (let i = 0; i < MEASURE_KEYS.length; i++) {
    for (let j = 0; j < MEASURE_KEYS.length; j++) {
      const ki = MEASURE_KEYS[i], kj = MEASURE_KEYS[j]
      out[`${ki}|${kj}`] = controls.value.correlation === 'pearson'
        ? pearson(m.map(r => r[ki]), m.map(r => r[kj]))
        : spearman(m.map(r => r[ki]), m.map(r => r[kj]))
    }
  }
  return out
})

watch([matrix, corrs, controls, () => props.widened, activeNodeMask, selectedMask], () => nextTick(renderChart), { deep: true })

useD3Chart(chartContainer, renderChart)

function renderChart() {
  if (!chartContainer.value) return
  if (branches.value !== 'ready') return
  const m = matrix.value
  if (!m || !m.length) return

  d3.select(chartContainer.value).selectAll('*').remove()
  const PAD_OUT = 28
  const PAD_IN = 6
  // Square matrix; PAD_OUT acts as uniform inset (no margins object).
  const { totalW, totalH } = svgFrame(chartContainer.value, { top: 0, right: 0, bottom: 0, left: 0 }, { fallbackW: 600 })
  const side = Math.min(totalW, totalH)
  const inner = Math.max(0, side - PAD_OUT * 2)
  const cell = Math.max(0, (inner - PAD_IN * 3) / 4)
  if (cell < 20) return  // matrix too cramped — card collapsed

  const svg = d3.select(chartContainer.value).append('svg').attr('width', totalW).attr('height', totalH)
  const root = svg.append('g').attr('transform', `translate(${PAD_OUT},${PAD_OUT})`)
  const tooltip = makeTooltip(chartContainer.value)

  // Per-measure scales shared across rows/cols.
  const scales = {}
  for (const k of MEASURE_KEYS) {
    const vals = m.map(r => r[k]).filter(v => v > 0)
    const lo = d3.min(vals) || 1e-12
    const hi = d3.max(m, r => r[k]) || 1
    if (controls.value.logAxes) {
      scales[k] = d3.scaleLog().domain([Math.max(lo, 1e-12), hi]).clamp(true)
    } else {
      scales[k] = d3.scaleLinear().domain([0, hi])
    }
  }

  for (let row = 0; row < 4; row++) {
    for (let col = 0; col < 4; col++) {
      const kRow = MEASURE_KEYS[row], kCol = MEASURE_KEYS[col]
      const cx = col * (cell + PAD_IN)
      const cy = row * (cell + PAD_IN)
      const cellG = root.append('g').attr('transform', `translate(${cx},${cy})`)

      cellG.append('rect').attr('width', cell).attr('height', cell)
        .attr('fill', '#fff').attr('stroke', '#e2e8f0').attr('stroke-width', 1).attr('rx', 4)

      if (row === col) {
        // Diagonal: measure name + 3 correlations with other measures.
        cellG.append('text')
          .attr('x', cell / 2).attr('y', cell / 2 - 14)
          .attr('text-anchor', 'middle').attr('font-size', '12px')
          .attr('font-weight', '600').attr('fill', '#0f172a')
          .text(MEASURE_LABELS[kRow])
        const others = MEASURE_KEYS.filter(k => k !== kRow)
        others.forEach((k, i) => {
          const r = corrs.value[`${kRow}|${k}`] ?? 0
          cellG.append('text')
            .attr('x', cell / 2).attr('y', cell / 2 + 2 + i * 12)
            .attr('text-anchor', 'middle').attr('font-size', '10px').attr('fill', '#475569')
            .text(`${MEASURE_LABELS[k][0]}: ${r.toFixed(2)}`)
        })
      } else if (row > col) {
        const xs = scales[kCol].copy().range([6, cell - 6])
        const ys = scales[kRow].copy().range([cell - 6, 6])
        const pts = m
          .filter(r => (!controls.value.logAxes || (r[kCol] > 0 && r[kRow] > 0)))
        cellG.selectAll('circle').data(pts).join('circle')
          .attr('cx', d => xs(d[kCol]))
          .attr('cy', d => ys(d[kRow]))
          .attr('r', d => isSelected(d.id) ? 2.6 : 1.6)
          .attr('fill', d => typeColor(effNodeType(d)))
          .attr('stroke', d => isSelected(d.id) ? '#0f172a' : 'none')
          .attr('stroke-width', d => isSelected(d.id) ? 0.8 : 0)
          .attr('opacity', d => isActive(d.id) ? 0.55 : ATTENUATED_OPACITY)
          .style('cursor', 'pointer')
          .on('click', (_, d) => selection.toggle(d.id))
          .on('mouseover', (ev, d) => showTip(tooltip, ev,
            `<strong>${d.id}</strong><br>${effNodeType(d)}<br>${MEASURE_LABELS[kCol]} ${FORMATTERS.exponential(d[kCol])}<br>${MEASURE_LABELS[kRow]} ${FORMATTERS.exponential(d[kRow])}`))
          .on('mousemove', (ev) => showTip(tooltip, ev, null))
          .on('mouseout', () => hideTip(tooltip))
      } else {
        // Upper triangle: prominent correlation heat-cell.
        const r = corrs.value[`${kRow}|${kCol}`] ?? 0
        const abs = Math.abs(r)
        cellG.append('rect').attr('width', cell).attr('height', cell)
          .attr('fill', r >= 0 ? '#0ea5e9' : '#ef4444')
          .attr('opacity', Math.min(0.4, abs * 0.4))
          .attr('rx', 4)
        cellG.append('text')
          .attr('x', cell / 2).attr('y', cell / 2 + 4)
          .attr('text-anchor', 'middle')
          .attr('font-size', Math.max(11, cell * 0.18))
          .attr('font-weight', '600').attr('fill', '#0f172a')
          .text(r.toFixed(2))
      }
    }
  }

  const types = [...new Set(m.map(r => effNodeType(r)))]
  drawTypeLegend(svg, totalW, types, typeColor)

  svg.append('text')
    .attr('x', PAD_OUT).attr('y', totalH - 6)
    .attr('font-size', '10px').attr('fill', '#94a3b8')
    .text(`Closeness: undirected variant · Correlation: ${controls.value.correlation}`)
}

</script>

<template>
  <div class="flex flex-col gap-1.5 h-full">
    <Teleport v-if="controlsTarget" :to="`#${controlsTarget}`">
      <div class="grid grid-cols-2 auto-rows-min gap-1.5">
        <ControlSection title="Axes">
          <ControlSwitch label="Log axes" :model-value="controls.logAxes"
            @update:model-value="updateControl('logAxes', $event)" />
        </ControlSection>
        <ControlSection title="Correlation">
          <ControlToggleGroup :model-value="controls.correlation" :options="CORR_OPTIONS"
            @update:model-value="updateControl('correlation', $event)" />
        </ControlSection>
      </div>
    </Teleport>

    <div v-if="branches === 'error'" class="flex flex-1 items-center justify-center text-sm text-red-600 surface-recessed rounded-lg p-3 text-center">
      Impossibile calcolare la comparazione: {{ all.failedMeasures.value.join(', ') }} non disponibili.
    </div>
    <div v-else-if="branches === 'loading'" class="flex flex-1 flex-col items-center justify-center gap-2 text-sm text-secondary surface-recessed rounded-lg p-3">
      <span>Computing centralities…</span>
      <div class="flex flex-col gap-0.5 text-[11px] text-muted">
        <span>Spectral: {{ all.status.value.spectral }}</span>
        <span>Betweenness: {{ all.status.value.betweenness }}</span>
        <span>Closeness: {{ all.status.value.closeness }}</span>
      </div>
    </div>
    <p v-if="branches === 'ready' && noNodesActive" class="text-[10px] italic text-amber-600 px-1">No data under current filters.</p>
    <p v-else-if="branches === 'ready' && edgeFilterActive" class="text-[10px] italic text-muted px-1">
      Correlations computed on the full graph; edge filter attenuates marks only.
    </p>
    <div v-if="branches === 'ready'" ref="chartContainer" class="chart-elev w-full" style="aspect-ratio: 1/1; position: relative;"></div>
  </div>
</template>
