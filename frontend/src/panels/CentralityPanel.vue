<script setup>
// Parametric panel for the 4 single-measure centralities (PR/Eig/Betw/Clos).
// Two views: Specific (measure-characteristic viz, default) and Generic (Deg-vs-Centrality scatter, comparable across measures).
import { ref, computed, toRef, watch, nextTick } from 'vue'
import { storeToRefs } from 'pinia'
import * as d3 from 'd3'
import { useCentrality } from '@/composables/useCentrality.js'
import { useNodeTypeColors } from '@/composables/useNodeTypeColors.js'
import { usePanelContextFromProps } from '@/composables/usePanelContext.js'
import { useFiltersStore } from '@/stores/filters.js'
import { useSelectionStore } from '@/stores/selection.js'
import { usePanel } from './usePanel.js'
import { useD3Chart } from './useD3Chart.js'
import {
  COLOR_SCHEME, FORMATTERS, makeTooltip, showTip, hideTip,
  drawGrid, drawAxes, drawTypeLegend, spearman, svgFrame,
  ATTENUATED_OPACITY,
} from './shared.js'
import ControlSection from './controls/ControlSection.vue'
import ControlSwitch from './controls/ControlSwitch.vue'
import ControlToggleGroup from './controls/ControlToggleGroup.vue'

const props = defineProps({
  panelSpec: { type: Object, required: true },
  schema: { type: Object, default: null },
  graphId: { type: String, default: null },
  measure: { type: String, required: true },
  widened: { type: Boolean, default: false },
  controlsTarget: { type: String, default: null },
})

const { data, status } = useCentrality(props.measure)
const { color: typeColor } = useNodeTypeColors(toRef(props, 'schema'))
const { controls, updateControl } = usePanel(props, props.panelSpec?.id, data)
const filters = useFiltersStore()
const { hideIsolated } = storeToRefs(filters)
const selection = useSelectionStore()
const { ids: filterSelected } = storeToRefs(selection)
const { activeNodeMask, isActive } = usePanelContextFromProps(props)

const chartContainer = ref(null)

const isPageRank = computed(() => props.measure === 'spectral_pagerank')
const isEigenvector = computed(() => props.measure === 'spectral_eigenvector')
const isBetweenness = computed(() => props.measure === 'betweenness')
const isCloseness = computed(() => props.measure === 'closeness')

// Closeness has 1-3 direction variants; pick the active one (undirected/out/in).
const closenessVariant = computed(() => {
  if (!isCloseness.value || !data.value) return null
  const dir = controls.value.closeDirection ?? 'undirected'
  return data.value[dir] ?? data.value.undirected ?? null
})

// Unified records accessor across measures.
const valuesPayload = computed(() => {
  if (isCloseness.value) return closenessVariant.value
  return data.value
})

const allValues = computed(() => valuesPayload.value?.values ?? [])

const labelFor = computed(() => ({
  spectral_pagerank: 'PageRank',
  spectral_eigenvector: 'Eigenvector',
  betweenness: 'Betweenness',
  closeness: 'Closeness',
}[props.measure] ?? 'Centrality'))

watch(
  [data, status, controls, filterSelected, hideIsolated, () => props.widened, activeNodeMask],
  () => nextTick(renderChart),
  { deep: true },
)

useD3Chart(chartContainer, renderChart)

function renderChart() {
  if (!chartContainer.value) return
  if (status.value !== 'ready') return
  d3.select(chartContainer.value).selectAll('*').remove()

  if (controls.value.view === 'generic') {
    renderGenericScatter()
    return
  }
  if (isPageRank.value) renderPageRankBars()
  else if (isEigenvector.value) renderEigenvectorDecay()
  else if (isBetweenness.value) renderBetweennessLorenz()
  else if (isCloseness.value) renderClosenessViolins()
}

// Zero-margin frame; each renderer sets its own inner margins below.
const ZERO_MARGINS = { top: 0, right: 0, bottom: 0, left: 0 }
function frame() {
  const el = chartContainer.value
  const { totalW, totalH } = svgFrame(el, ZERO_MARGINS, { fallbackW: 600 })
  return { el, totalW, totalH }
}

// Generic: Degree vs Centrality scatter.
function renderGenericScatter() {
  const { el, totalW, totalH } = frame()
  const MARGINS = { top: 8, right: 12, bottom: 38, left: 56 }
  const innerW = totalW - MARGINS.left - MARGINS.right
  const innerH = totalH - MARGINS.top - MARGINS.bottom

  const svg = d3.select(el).append('svg').attr('width', totalW).attr('height', totalH)
  const g = svg.append('g').attr('transform', `translate(${MARGINS.left},${MARGINS.top})`)
  const tooltip = makeTooltip(el)

  let pts = allValues.value
  // Captioned at bottom when nonzero.
  const isolatedHidden = hideIsolated.value
    ? pts.filter(r => r.degree === 0).length
    : 0
  if (hideIsolated.value) pts = pts.filter(r => r.degree > 0)

  // Log scales additionally require value > 0; silently drop the rest.
  const useLogX = !!controls.value.xLog
  const useLogY = !!controls.value.yLog
  let visible = pts
  if (useLogX) visible = visible.filter(r => r.degree > 0)
  if (useLogY) visible = visible.filter(r => r.value > 0)
  if (!visible.length) return

  const xExtent = d3.extent(visible, d => d.degree)
  const yExtent = d3.extent(visible, d => d.value)
  const xScale = (useLogX ? d3.scaleLog() : d3.scaleLinear())
    .domain([useLogX ? Math.max(1, xExtent[0]) : xExtent[0], xExtent[1]])
    .range([0, innerW]).clamp(true)
  const yScale = (useLogY ? d3.scaleLog() : d3.scaleLinear())
    .domain([useLogY ? Math.max(1e-12, yExtent[0]) : 0, yExtent[1]])
    .range([innerH, 0]).clamp(true)

  drawGrid(g, xScale, yScale, innerW, innerH)

  // OLS log-log fit y=α·x^β; Spearman ρ on raw values.
  if (controls.value.fitLine && visible.length > 2) {
    const fitPts = visible.filter(r => r.degree > 0 && r.value > 0)
    if (fitPts.length > 2) {
      const lx = fitPts.map(r => Math.log(r.degree))
      const ly = fitPts.map(r => Math.log(r.value))
      const meanX = d3.mean(lx), meanY = d3.mean(ly)
      let num = 0, den = 0
      for (let i = 0; i < lx.length; i++) {
        num += (lx[i] - meanX) * (ly[i] - meanY)
        den += (lx[i] - meanX) ** 2
      }
      if (den > 0) {
        const beta = num / den
        const logAlpha = meanY - beta * meanX
        const fitX = d3.range(20).map(i => xExtent[0] + (xExtent[1] - xExtent[0]) * i / 19).filter(x => x > 0)
        const linePts = fitX.map(x => ({ x, y: Math.exp(logAlpha) * Math.pow(x, beta) }))
        const line = d3.line()
          .x(d => xScale(d.x)).y(d => yScale(d.y))
          .defined(d => isFinite(xScale(d.x)) && isFinite(yScale(d.y)))
        g.append('path').datum(linePts).attr('fill', 'none')
          .attr('stroke', '#94a3b8').attr('stroke-width', 1.4)
          .attr('stroke-dasharray', '5,4').attr('opacity', 0.9)
          .attr('d', line)

        // Rank-based ρ — robust to heavy tails typical of centralities.
        const rho = spearman(fitPts.map(r => r.degree), fitPts.map(r => r.value))
        svg.append('text')
          .attr('x', MARGINS.left + 6).attr('y', MARGINS.top + 12)
          .attr('font-size', '10px').attr('fill', '#64748b')
          .text(`y = αx^β  β=${beta.toFixed(2)}  ρ=${rho.toFixed(2)}`)
      }
    }
  }

  const ringSet = new Set()
  if (controls.value.topKHighlight) {
    const top = [...visible].sort((a, b) => b.value - a.value).slice(0, 10)
    top.forEach(r => ringSet.add(r.id))
  }

  const selectedSet = new Set(filterSelected.value ?? [])

  g.selectAll('circle.dot').data(visible).join('circle')
    .attr('class', 'dot')
    .attr('cx', d => xScale(d.degree))
    .attr('cy', d => yScale(d.value))
    .attr('r', d => ringSet.has(d.id) ? 4.5 : 3)
    .attr('fill', d => typeColor(d.type))
    .attr('stroke', d => ringSet.has(d.id) ? '#0f172a' : (selectedSet.has(d.id) ? '#0f172a' : 'none'))
    .attr('stroke-width', d => ringSet.has(d.id) || selectedSet.has(d.id) ? 1.5 : 0)
    .attr('opacity', d => isActive(d.id) ? 0.7 : ATTENUATED_OPACITY)
    .style('cursor', 'pointer')
    .on('mouseover', (ev, d) => showTip(tooltip, ev,
      `<strong>${d.id}</strong><br>${d.type}<br>deg ${d.degree} · ${labelFor.value} ${FORMATTERS.exponential(d.value)}`))
    .on('mousemove', (ev) => showTip(tooltip, ev, null))
    .on('mouseout', () => hideTip(tooltip))
    .on('click', (_, d) => toggleSelected(d.id))

  drawAxes(g, xScale, yScale, innerW, innerH, {
    xLabel: 'Degree k', yLabel: labelFor.value,
    yTickFmt: useLogY ? '.0e' : '.2~e',
  })

  drawTypeLegend(svg, totalW, typesInData(), typeColor)

  const captions = []
  if (isolatedHidden) captions.push(`${isolatedHidden} isolated nodes hidden`)
  if (isEigenvector.value) {
    const excluded = data.value?.excluded_nodes ?? 0
    if (excluded > 0) captions.push(`${excluded} nodes outside LCC excluded`)
  }
  if (captions.length) {
    svg.append('text')
      .attr('x', totalW - 8).attr('y', totalH - 4)
      .attr('text-anchor', 'end').attr('font-size', '10px').attr('fill', '#94a3b8')
      .text(captions.join(' · '))
  }
}

// PageRank rank-mass bars.
function renderPageRankBars() {
  const { el, totalW, totalH } = frame()
  const MARGINS = { top: 12, right: 70, bottom: 28, left: 110 }

  // Full-graph denominator preserves "% of total rank mass" under type subsetting.
  const denom = d3.sum(allValues.value, r => r.value) || 1

  const allowedTypes = computedShowTypes()
  const filtered = allValues.value
    .filter(r => allowedTypes.has(r.type))
    .sort((a, b) => b.value - a.value)
    .slice(0, controls.value.topN || 20)

  if (!filtered.length) return

  const innerW = totalW - MARGINS.left - MARGINS.right
  const innerH = totalH - MARGINS.top - MARGINS.bottom

  const svg = d3.select(el).append('svg').attr('width', totalW).attr('height', totalH)
  const g = svg.append('g').attr('transform', `translate(${MARGINS.left},${MARGINS.top})`)
  const tooltip = makeTooltip(el)

  const xMax = filtered[0].value / denom
  const xScale = d3.scaleLinear().domain([0, xMax]).range([0, innerW])
  const yScale = d3.scaleBand().domain(filtered.map(r => r.id)).range([0, innerH]).padding(0.18)

  const truncate = s => s.length > 14 ? s.slice(0, 12) + '…' : s
  const yAxis = d3.axisLeft(yScale).tickFormat(d => truncate(String(d)))
  g.append('g').call(yAxis)
    .selectAll('text').attr('font-size', 10).attr('fill', '#475569')

  const xAxis = d3.axisBottom(xScale).ticks(4, '.0%')
  g.append('g').attr('transform', `translate(0,${innerH})`).call(xAxis)
    .selectAll('text').attr('font-size', 10).attr('fill', '#64748b')

  svg.append('text')
    .attr('x', MARGINS.left + innerW / 2).attr('y', totalH - 4)
    .attr('text-anchor', 'middle').attr('font-size', 11).attr('fill', '#475569')
    .text('% of total PageRank mass')

  const selectedSet = new Set(filterSelected.value ?? [])

  g.selectAll('rect.bar').data(filtered).join('rect')
    .attr('class', 'bar')
    .attr('x', 0)
    .attr('y', d => yScale(d.id))
    .attr('width', d => xScale(d.value / denom))
    .attr('height', yScale.bandwidth())
    .attr('fill', d => typeColor(d.type))
    .attr('stroke', d => selectedSet.has(d.id) ? '#0f172a' : 'none')
    .attr('stroke-width', d => selectedSet.has(d.id) ? 1.5 : 0)
    .attr('opacity', d => isActive(d.id) ? 0.85 : ATTENUATED_OPACITY)
    .style('cursor', 'pointer')
    .on('mouseover', (ev, d) => showTip(tooltip, ev,
      `<strong>${d.id}</strong><br>${d.type}<br>PR ${FORMATTERS.exponential(d.value)}<br>${((d.value / denom) * 100).toFixed(2)}% of total`))
    .on('mousemove', (ev) => showTip(tooltip, ev, null))
    .on('mouseout', () => hideTip(tooltip))
    .on('click', (_, d) => toggleSelected(d.id))

  g.selectAll('text.pct').data(filtered).join('text')
    .attr('class', 'pct')
    .attr('x', d => xScale(d.value / denom) + 4)
    .attr('y', d => yScale(d.id) + yScale.bandwidth() / 2)
    .attr('dy', '0.35em')
    .attr('font-size', 10).attr('fill', '#475569')
    .text(d => `${((d.value / denom) * 100).toFixed(2)}%`)

  drawTypeLegend(svg, totalW, [...new Set(filtered.map(r => r.type))], typeColor)
}

// null / empty array means "all" — keeps payload compact.
function computedShowTypes() {
  const all = props.schema?.node_types ?? []
  const sel = controls.value.showTypes
  if (!sel || sel.length === 0) return new Set(all)
  return new Set(sel)
}

// Eigenvector decay-from-core boxplots over EV-rank quantile shells.
function renderEigenvectorDecay() {
  const { el, totalW, totalH } = frame()
  const MARGINS = { top: 12, right: 12, bottom: 38, left: 60 }
  const innerW = totalW - MARGINS.left - MARGINS.right
  const innerH = totalH - MARGINS.top - MARGINS.bottom

  // Quantile shells are a proxy for hop-distance — edges aren't in this payload.
  const values = allValues.value
  if (!values.length) return
  const sorted = [...values].sort((a, b) => b.value - a.value)
  let anchor
  if (controls.value.anchor === 'selected' && filterSelected.value?.length) {
    const sid = String(filterSelected.value[0])
    anchor = sorted.find(r => r.id === sid)
    if (!anchor) {
      // No EV value → node outside LCC.
      d3.select(el).append('div')
        .style('display', 'flex').style('align-items', 'center').style('justify-content', 'center')
        .style('height', '100%').style('padding', '1rem')
        .style('font-size', '12px').style('color', '#64748b').style('text-align', 'center')
        .text(`Anchor selezionato (${sid}) fuori dalla LCC: Eigenvector indefinito.`)
      return
    }
  } else {
    anchor = sorted[0]
  }

  const SHELLS = 6
  const shellSize = Math.ceil(sorted.length / SHELLS)
  const shells = []
  for (let s = 0; s < SHELLS; s++) {
    const slice = sorted.slice(s * shellSize, (s + 1) * shellSize)
    if (slice.length) shells.push({ label: `Q${s + 1}`, items: slice })
  }

  const svg = d3.select(el).append('svg').attr('width', totalW).attr('height', totalH)
  const g = svg.append('g').attr('transform', `translate(${MARGINS.left},${MARGINS.top})`)
  const tooltip = makeTooltip(el)

  const xScale = d3.scaleBand().domain(shells.map(s => s.label)).range([0, innerW]).padding(0.25)
  const useLogY = !!controls.value.yLog
  const yExtent = [
    d3.min(values, d => d.value), d3.max(values, d => d.value),
  ]
  const yScale = (useLogY ? d3.scaleLog() : d3.scaleLinear())
    .domain([useLogY ? Math.max(1e-12, yExtent[0]) : 0, yExtent[1]])
    .range([innerH, 0]).clamp(true)

  drawGrid(g, d3.scaleLinear().domain([0, 1]).range([0, innerW]), yScale, innerW, innerH)

  shells.forEach(s => {
    const vals = s.items.map(r => r.value).sort((a, b) => a - b)
    if (!vals.length) return
    const q = p => d3.quantileSorted(vals, p)
    const x = xScale(s.label)
    const w = xScale.bandwidth()
    const cx = x + w / 2
    const q1 = q(0.25), q2 = q(0.5), q3 = q(0.75)
    const iqr = q3 - q1
    const lo = Math.max(vals[0], q1 - 1.5 * iqr)
    const hi = Math.min(vals[vals.length - 1], q3 + 1.5 * iqr)

    g.append('line').attr('x1', cx).attr('x2', cx)
      .attr('y1', yScale(lo)).attr('y2', yScale(hi))
      .attr('stroke', '#64748b').attr('stroke-width', 1)
    g.append('rect')
      .attr('x', x).attr('y', yScale(q3))
      .attr('width', w).attr('height', Math.max(1, yScale(q1) - yScale(q3)))
      .attr('fill', COLOR_SCHEME.accent).attr('opacity', 0.35)
      .attr('stroke', COLOR_SCHEME.accent).attr('stroke-width', 1)
    g.append('line').attr('x1', x).attr('x2', x + w)
      .attr('y1', yScale(q2)).attr('y2', yScale(q2))
      .attr('stroke', '#0f172a').attr('stroke-width', 1.5)

    g.append('rect').attr('x', x).attr('y', 0).attr('width', w).attr('height', innerH)
      .attr('fill', 'transparent').style('cursor', 'pointer')
      .on('mouseover', (ev) => showTip(tooltip, ev,
        `<strong>${s.label}</strong><br>n=${vals.length}<br>median ${FORMATTERS.exponential(q2)}<br>IQR [${FORMATTERS.exponential(q1)}, ${FORMATTERS.exponential(q3)}]`))
      .on('mousemove', (ev) => showTip(tooltip, ev, null))
      .on('mouseout', () => hideTip(tooltip))
  })

  drawAxes(g, xScale, yScale, innerW, innerH, {
    xLabel: 'Rank shell (Q1 = top)', yLabel: 'Eigenvector value',
    yTickFmt: useLogY ? '.0e' : '.2~e',
  })

  svg.append('text')
    .attr('x', MARGINS.left + 6).attr('y', MARGINS.top + 12)
    .attr('font-size', '10px').attr('fill', '#64748b')
    .text(`Anchor: ${anchor.id} (${FORMATTERS.exponential(anchor.value)})`)
}

// Betweenness Lorenz curve + Gini.
function renderBetweennessLorenz() {
  const { el, totalW, totalH } = frame()
  const MARGINS = { top: 12, right: 12, bottom: 38, left: 56 }
  const innerW = totalW - MARGINS.left - MARGINS.right
  const innerH = totalH - MARGINS.top - MARGINS.bottom

  const values = allValues.value
  if (!values.length) return
  const sorted = [...values].sort((a, b) => a.value - b.value)
  const n = sorted.length
  const total = d3.sum(sorted, r => r.value) || 1

  let cum = 0
  const lorenz = [{ x: 0, y: 0 }]
  for (let i = 0; i < n; i++) {
    cum += sorted[i].value
    lorenz.push({ x: (i + 1) / n, y: cum / total })
  }
  let gini = 0
  for (let i = 1; i < lorenz.length; i++) {
    const dx = lorenz[i].x - lorenz[i - 1].x
    const avgY = (lorenz[i].y + lorenz[i - 1].y) / 2
    gini += dx * (lorenz[i].x - avgY) * 2
  }

  const svg = d3.select(el).append('svg').attr('width', totalW).attr('height', totalH)
  const g = svg.append('g').attr('transform', `translate(${MARGINS.left},${MARGINS.top})`)
  const tooltip = makeTooltip(el)

  const xScale = d3.scaleLinear().domain([0, 1]).range([0, innerW])
  const yScale = d3.scaleLinear().domain([0, 1]).range([innerH, 0])

  drawGrid(g, xScale, yScale, innerW, innerH)

  // Perfect-equality reference diagonal.
  g.append('line').attr('x1', 0).attr('x2', innerW).attr('y1', innerH).attr('y2', 0)
    .attr('stroke', '#cbd5e1').attr('stroke-width', 1).attr('stroke-dasharray', '4,4')

  const line = d3.line().x(d => xScale(d.x)).y(d => yScale(d.y))
  g.append('path').datum(lorenz).attr('fill', 'none')
    .attr('stroke', COLOR_SCHEME.accent).attr('stroke-width', 2).attr('d', line)

  drawAxes(g, xScale, yScale, innerW, innerH, {
    xLabel: 'Cumulative share of nodes', yLabel: 'Cumulative share of Betweenness',
    xTickFmt: '.0%', yTickFmt: '.0%',
  })

  svg.append('text')
    .attr('x', MARGINS.left + innerW - 6).attr('y', MARGINS.top + 14)
    .attr('text-anchor', 'end').attr('font-size', '11px').attr('font-weight', '600').attr('fill', '#0f172a')
    .text(`Gini ${gini.toFixed(3)}`)

  if (controls.value.lorenzOverlay) {
    const k = Number(controls.value.lorenzOverlayK) || 5
    const topK = [...values].sort((a, b) => b.value - a.value).slice(0, k)
    const topIds = new Set(topK.map(r => r.id))
    // Locate each top-k on the Lorenz curve.
    let cum2 = 0
    const marks = []
    for (let i = 0; i < n; i++) {
      cum2 += sorted[i].value
      if (topIds.has(sorted[i].id)) {
        marks.push({
          ...sorted[i],
          x: (i + 1) / n,
          y: cum2 / total,
        })
      }
    }
    const selectedSet = new Set(filterSelected.value ?? [])
    g.selectAll('circle.topk').data(marks).join('circle')
      .attr('class', 'topk')
      .attr('cx', d => xScale(d.x))
      .attr('cy', d => yScale(d.y))
      .attr('r', 5)
      .attr('fill', d => typeColor(d.type))
      .attr('stroke', d => selectedSet.has(d.id) ? '#0f172a' : '#fff')
      .attr('stroke-width', 1.5)
      .attr('opacity', d => isActive(d.id) ? 1 : ATTENUATED_OPACITY)
      .style('cursor', 'pointer')
      .on('mouseover', (ev, d) => showTip(tooltip, ev,
        `<strong>${d.id}</strong><br>${d.type}<br>Betw ${FORMATTERS.exponential(d.value)}<br>cum frac ${(d.x * 100).toFixed(1)}%`))
      .on('mousemove', (ev) => showTip(tooltip, ev, null))
      .on('mouseout', () => hideTip(tooltip))
      .on('click', (_, d) => toggleSelected(d.id))

    drawTypeLegend(svg, totalW, [...new Set(marks.map(r => r.type))], typeColor)
  }
}

// Closeness violins per node type (with sparse-type strip fallback).
function renderClosenessViolins() {
  const { el, totalW, totalH } = frame()
  const variant = closenessVariant.value
  if (!variant) return

  // Degenerate variant → static explanation only.
  if (variant.degenerate) {
    const frac = (variant.largest_component_fraction ?? 0) * 100
    d3.select(el).append('div')
      .style('display', 'flex').style('align-items', 'center').style('justify-content', 'center')
      .style('height', '100%').style('padding', '1rem')
      .style('font-size', '12px').style('color', '#64748b').style('text-align', 'center')
      .html(`Closeness <b>${controls.value.closeDirection}</b> non informativa: la componente fortemente connessa più grande contiene solo il ${frac.toFixed(2)}% dei nodi. Vedi variante <b>Undirected</b>.`)
    return
  }

  const MARGINS = { top: 12, right: 12, bottom: 50, left: 56 }
  const innerW = totalW - MARGINS.left - MARGINS.right
  const innerH = totalH - MARGINS.top - MARGINS.bottom

  const byType = variant.by_type || {}
  const counts = variant.count_per_type || {}
  let types = Object.keys(byType)
  if (controls.value.closeSort === 'alpha') {
    types.sort((a, b) => a.localeCompare(b))
  } else {
    // Median desc surfaces the "most central type" first.
    const medianOf = (t) => d3.median(byType[t].map(r => r.value)) ?? 0
    types.sort((a, b) => medianOf(b) - medianOf(a))
  }

  const svg = d3.select(el).append('svg').attr('width', totalW).attr('height', totalH)
  const g = svg.append('g').attr('transform', `translate(${MARGINS.left},${MARGINS.top})`)
  const tooltip = makeTooltip(el)

  const xScale = d3.scaleBand().domain(types).range([0, innerW]).padding(0.2)
  const allVals = variant.values.map(r => r.value)
  const yScale = d3.scaleLinear().domain([0, d3.max(allVals) || 1]).range([innerH, 0])

  drawGrid(g, d3.scaleLinear().domain([0, 1]).range([0, innerW]), yScale, innerW, innerH)

  types.forEach(t => {
    const records = byType[t]
    const vals = records.map(r => r.value).sort((a, b) => a - b)
    const n = counts[t] ?? vals.length
    const x = xScale(t)
    const w = xScale.bandwidth()
    const cx = x + w / 2

    if (n < 5) {
      // Sparse-type fallback: jittered strip plot.
      g.selectAll(null).data(records).enter().append('circle')
        .attr('cx', () => cx + (Math.random() - 0.5) * w * 0.5)
        .attr('cy', d => yScale(d.value))
        .attr('r', 3.5)
        .attr('fill', typeColor(t))
        .attr('opacity', d => isActive(d.id) ? 0.85 : ATTENUATED_OPACITY)
        .style('cursor', 'pointer')
        .on('mouseover', (ev, d) => showTip(tooltip, ev,
          `<strong>${d.id}</strong><br>${t}<br>Closeness ${FORMATTERS.exponential(d.value)}`))
        .on('mousemove', (ev) => showTip(tooltip, ev, null))
        .on('mouseout', () => hideTip(tooltip))
        .on('click', (_, d) => toggleSelected(d.id))
      return
    }

    const yMin = vals[0], yMax = vals[vals.length - 1]
    const bw = Math.max(1e-12, (yMax - yMin) * 0.08)
    const kerns = d3.range(0, 41).map(i => yMin + (yMax - yMin) * i / 40)
    const density = kerns.map(yk => {
      const u = vals.reduce((acc, v) => acc + Math.exp(-((v - yk) ** 2) / (2 * bw * bw)), 0)
      return { y: yk, d: u / (vals.length * bw * Math.sqrt(2 * Math.PI)) }
    })
    const maxD = d3.max(density, p => p.d) || 1
    const widthScale = d3.scaleLinear().domain([0, maxD]).range([0, w / 2])

    const areaR = d3.area()
      .x0(() => cx)
      .x1(p => cx + widthScale(p.d))
      .y(p => yScale(p.y))
      .curve(d3.curveCatmullRom)
    const areaL = d3.area()
      .x0(p => cx - widthScale(p.d))
      .x1(() => cx)
      .y(p => yScale(p.y))
      .curve(d3.curveCatmullRom)

    g.append('path').datum(density).attr('d', areaR).attr('fill', typeColor(t)).attr('opacity', 0.45)
    g.append('path').datum(density).attr('d', areaL).attr('fill', typeColor(t)).attr('opacity', 0.45)

    // 25/50/75 percentile marks.
    const q = p => d3.quantileSorted(vals, p)
    ;[0.25, 0.5, 0.75].forEach(p => {
      const yp = yScale(q(p))
      g.append('line').attr('x1', cx - 6).attr('x2', cx + 6)
        .attr('y1', yp).attr('y2', yp)
        .attr('stroke', '#0f172a').attr('stroke-width', p === 0.5 ? 1.8 : 1)
        .attr('opacity', p === 0.5 ? 1 : 0.6)
    })

    g.append('rect').attr('x', x).attr('y', 0).attr('width', w).attr('height', innerH)
      .attr('fill', 'transparent').style('cursor', 'default')
      .on('mouseover', (ev) => showTip(tooltip, ev,
        `<strong>${t}</strong><br>n=${vals.length}<br>median ${FORMATTERS.exponential(q(0.5))}<br>IQR [${FORMATTERS.exponential(q(0.25))}, ${FORMATTERS.exponential(q(0.75))}]`))
      .on('mousemove', (ev) => showTip(tooltip, ev, null))
      .on('mouseout', () => hideTip(tooltip))
  })

  drawAxes(g, xScale, yScale, innerW, innerH, {
    xLabel: 'Node type', yLabel: 'Closeness',
    yTickFmt: '.2~e',
  })

  if (types.length > 4) {
    g.selectAll('g.tick text').filter(function (d) { return types.includes(d) })
      .attr('transform', 'rotate(-20)').attr('text-anchor', 'end').attr('dx', '-0.3em').attr('dy', '0.2em')
  }
}

function typesInData() {
  return [...new Set(allValues.value.map(r => r.type))]
}

function toggleSelected(id) {
  selection.toggle(id)
}

const VIEW_OPTIONS = [
  { k: 'specific', label: 'Specific' },
  { k: 'generic', label: 'Generic' },
]
const TOP_N_OPTIONS = [
  { k: 10, label: '10' }, { k: 20, label: '20' },
  { k: 50, label: '50' }, { k: 100, label: '100' },
]
const ANCHOR_OPTIONS = computed(() => [
  { k: 'top', label: 'Top eigenvector' },
  { k: 'selected', label: 'Selected node', disabled: filterSelected.value.length === 0,
    title: filterSelected.value.length === 0 ? 'Select a node first' : '' },
])
const LORENZ_K_OPTIONS = [
  { k: 5, label: '5' }, { k: 10, label: '10' }, { k: 20, label: '20' },
]
const CLOSE_SORT_OPTIONS = [
  { k: 'median', label: 'Median desc' }, { k: 'alpha', label: 'Alphabetical' },
]
const DIRECTION_OPTIONS = [
  { k: 'undirected', label: 'Undirected' },
  { k: 'out', label: 'Out' },
  { k: 'in', label: 'In' },
]

// PageRank "Show types" chip toggle; null/empty array means "all".
function isTypeShown(t) {
  const cur = controls.value.showTypes
  if (!cur || cur.length === 0) return true
  return cur.includes(t)
}
function togglePageRankType(t) {
  const all = props.schema?.node_types ?? []
  const cur = (!controls.value.showTypes || controls.value.showTypes.length === 0)
    ? [...all]
    : [...controls.value.showTypes]
  const i = cur.indexOf(t)
  if (i === -1) cur.push(t); else cur.splice(i, 1)
  if (cur.length === all.length) updateControl('showTypes', null)
  else updateControl('showTypes', cur)
}
</script>

<template>
  <div class="flex flex-col gap-1.5 h-full">
    <Teleport v-if="controlsTarget" :to="`#${controlsTarget}`">
      <div class="grid grid-cols-2 auto-rows-min gap-1.5">
        <ControlSection title="View" :col-span="2">
          <ControlToggleGroup :model-value="controls.view" :options="VIEW_OPTIONS"
            @update:model-value="updateControl('view', $event)" />
        </ControlSection>

        <ControlSection v-if="controls.view === 'generic'" title="Scatter" :col-span="2">
          <div class="grid grid-cols-2 gap-1">
            <ControlSwitch label="X log" :model-value="controls.xLog" @update:model-value="updateControl('xLog', $event)" />
            <ControlSwitch label="Y log" :model-value="controls.yLog" @update:model-value="updateControl('yLog', $event)" />
            <ControlSwitch label="Fit line" :model-value="controls.fitLine" @update:model-value="updateControl('fitLine', $event)" />
            <ControlSwitch label="Highlight top 10" :model-value="controls.topKHighlight" @update:model-value="updateControl('topKHighlight', $event)" />
          </div>
        </ControlSection>

        <!-- PageRank Specific -->
        <ControlSection v-if="isPageRank && controls.view === 'specific'" title="Top N">
          <ControlToggleGroup :model-value="controls.topN" :options="TOP_N_OPTIONS"
            @update:model-value="updateControl('topN', $event)" />
        </ControlSection>
        <ControlSection v-if="isPageRank && controls.view === 'specific'" title="Show types">
          <div class="flex flex-wrap gap-1">
            <button
              v-for="t in (props.schema?.node_types || [])" :key="t"
              class="type-chip px-1.5 py-0 text-[10px]"
              :class="{ 'type-chip--active': isTypeShown(t) }"
              :style="isTypeShown(t)
                ? { backgroundColor: typeColor(t) + '22', borderColor: typeColor(t), color: typeColor(t) }
                : { borderColor: typeColor(t), color: typeColor(t) }"
              @click="togglePageRankType(t)">{{ t }}</button>
          </div>
        </ControlSection>

        <!-- Eigenvector Specific -->
        <ControlSection v-if="isEigenvector && controls.view === 'specific'" title="Anchor" :col-span="2">
          <ControlToggleGroup :model-value="controls.anchor" :options="ANCHOR_OPTIONS"
            @update:model-value="updateControl('anchor', $event)" />
        </ControlSection>

        <!-- Betweenness Specific -->
        <ControlSection v-if="isBetweenness && controls.view === 'specific'" title="Top-k overlay">
          <ControlSwitch label="Show top-k" :model-value="controls.lorenzOverlay"
            @update:model-value="updateControl('lorenzOverlay', $event)" />
        </ControlSection>
        <ControlSection v-if="isBetweenness && controls.view === 'specific' && controls.lorenzOverlay" title="Top-k size">
          <ControlToggleGroup :model-value="controls.lorenzOverlayK" :options="LORENZ_K_OPTIONS"
            @update:model-value="updateControl('lorenzOverlayK', $event)" />
        </ControlSection>

        <!-- Closeness Specific -->
        <ControlSection v-if="isCloseness && controls.view === 'specific' && schema?.directed" title="Direction" :col-span="2">
          <ControlToggleGroup :model-value="controls.closeDirection" :options="DIRECTION_OPTIONS"
            @update:model-value="updateControl('closeDirection', $event)" />
        </ControlSection>
        <ControlSection v-if="isCloseness && controls.view === 'specific'" title="Sort" :col-span="2">
          <ControlToggleGroup :model-value="controls.closeSort" :options="CLOSE_SORT_OPTIONS"
            @update:model-value="updateControl('closeSort', $event)" />
        </ControlSection>
      </div>
    </Teleport>

    <div v-if="status === 'error'" class="flex flex-1 items-center justify-center text-sm text-red-600 surface-recessed rounded-lg p-3">
      Errore durante il calcolo di {{ labelFor }}.
    </div>
    <div v-else-if="status === 'cancelled'" class="flex flex-1 items-center justify-center text-sm text-secondary surface-recessed rounded-lg p-3 italic">
      Calcolo di {{ labelFor }} annullato.
    </div>
    <div v-else-if="status !== 'ready'" class="flex flex-1 items-center justify-center text-sm text-secondary surface-recessed rounded-lg p-3">
      Computing {{ labelFor }}…
    </div>
    <div v-else ref="chartContainer" class="chart-elev w-full" style="aspect-ratio: 4/3; position: relative;"></div>
    <p v-if="status === 'ready'" class="text-[10px] leading-tight text-muted px-1">
      {{ labelFor }} computed on the full graph; current filter attenuates non-matching marks.
    </p>
  </div>
</template>
