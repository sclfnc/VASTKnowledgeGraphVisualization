<script setup>
import { ref, watch, toRef } from 'vue'
import * as d3 from 'd3'
import { useMetrics } from '@/composables/useMetrics'
import { FORMATTERS, COLOR_SCHEME } from './shared.js'
import { PANEL_PROPS } from './panelProps.js'
import { usePanel } from './usePanel.js'
import ControlSwitch from './controls/ControlSwitch.vue'

const props = defineProps(PANEL_PROPS)

const { metrics: data, loading, error } = useMetrics(toRef(props, 'graphId'))
const { controls, updateControl } = usePanel(props, 'degree', data)
const chartContainer = ref(null)
const view = ref('CCDF')

const VIEWS = ['PMF', 'CCDF', 'Rank']
const MARGINS = { top: 8, right: 12, bottom: 38, left: 44 }

watch([data, controls, view], renderChart, { deep: true })

// ── Distribution builders ──────────────────────────────────────────
function buildPMF(seq) {
  const freq = new Map()
  for (const d of seq) freq.set(d, (freq.get(d) || 0) + 1)
  const n = seq.length
  return Array.from(freq.entries(), ([k, count]) => ({ k, p: count / n }))
    .sort((a, b) => a.k - b.k)
}

function buildCCDF(seq) {
  let cum = 0
  return buildPMF(seq).map(d => { const p = 1 - cum; cum += d.p; return { k: d.k, p } })
}

function buildRank(seq) {
  return [...seq].sort((a, b) => b - a).map((k, i) => ({ k: i + 1, p: k }))
}

function builderFor(viewName) {
  return viewName === 'Rank' ? buildRank : viewName === 'CCDF' ? buildCCDF : buildPMF
}

function typeStats(seq) {
  if (!seq.length) return null
  const n = seq.length
  const sorted = [...seq].sort((a, b) => a - b)
  const mean = seq.reduce((s, v) => s + v, 0) / n
  const std = Math.sqrt(seq.reduce((s, v) => s + (v - mean) ** 2, 0) / n)
  const mid = Math.floor(n / 2)
  const median = n % 2 ? sorted[mid] : (sorted[mid - 1] + sorted[mid]) / 2
  const pct = p => {
    const idx = (n - 1) * p, lo = Math.floor(idx), hi = Math.min(lo + 1, n - 1)
    return sorted[lo] + (sorted[hi] - sorted[lo]) * (idx - lo)
  }
  const q1 = pct(0.25), q3 = pct(0.75), iqr = q3 - q1
  const wlo = Math.max(sorted[0], q1 - 1.5 * iqr)
  const whi = Math.min(sorted[n - 1], q3 + 1.5 * iqr)
  return { mean, median, std, wlo, whi }
}

// ── DOM helpers ────────────────────────────────────────────────────
function makeTooltip(container) {
  return d3.select(container).append('div')
    .style('position', 'absolute').style('pointer-events', 'none')
    .style('background', 'white').style('border', '1px solid #e2e8f0')
    .style('border-radius', '4px').style('padding', '4px 8px')
    .style('font-size', '12px').style('color', '#334155').style('opacity', 0)
}

function showTip(tooltip, event, html) {
  tooltip.style('opacity', 1)
    .style('left', (event.offsetX + 12) + 'px')
    .style('top', (event.offsetY - 20) + 'px')
    .html(html)
}

function hideTip(tooltip) { tooltip.style('opacity', 0) }

function attachVLineTooltip(g, x, h, html, tooltip) {
  g.append('rect')
    .attr('x', x - 6).attr('y', 0).attr('width', 12).attr('height', h)
    .attr('fill', 'transparent').style('cursor', 'pointer')
    .on('mouseover', e => showTip(tooltip, e, html))
    .on('mousemove', e => tooltip.style('left', (e.offsetX + 12) + 'px').style('top', (e.offsetY - 20) + 'px'))
    .on('mouseout', () => hideTip(tooltip))
}

function buildScales(visible, innerW, lineH, useLogX, useLogY, isRank) {
  const minK = useLogX ? Math.max(1, d3.min(visible, d => d.k)) : (isRank ? 1 : 0)
  const maxK = d3.max(visible, d => d.k)
  const minP = d3.min(visible, d => d.p)
  const maxP = d3.max(visible, d => d.p)
  const xScale = useLogX
    ? d3.scaleLog().domain([minK, maxK]).range([0, innerW]).clamp(true)
    : d3.scaleLinear().domain([minK, maxK]).range([0, innerW])
  const yScale = useLogY
    ? d3.scaleLog().domain([Math.max(1e-6, minP), maxP]).range([lineH, 0]).clamp(true)
    : d3.scaleLinear().domain([0, maxP]).range([lineH, 0])
  return { xScale, yScale }
}

function drawAxes(g, xScale, yScale, innerW, lineH, useLogY, isRank, xLabel, yLabel) {
  g.append('g').call(d3.axisLeft(yScale).ticks(5, useLogY ? '.0e' : (isRank ? 'd' : '.0%')))
    .append('text').attr('transform', 'rotate(-90)').attr('x', -lineH / 2).attr('y', -32)
    .attr('fill', '#64748b').attr('font-size', '12px').attr('text-anchor', 'middle').text(yLabel)
  g.append('g').attr('transform', `translate(0,${lineH})`).call(d3.axisBottom(xScale).ticks(6))
    .append('text').attr('x', innerW / 2).attr('y', 28)
    .attr('fill', '#64748b').attr('font-size', '12px').attr('text-anchor', 'middle').text(xLabel)
}

function drawLine(g, pts, xScale, yScale, color) {
  const path = d3.line().x(d => xScale(d.k)).y(d => yScale(d.p))
  g.append('path').datum(pts).attr('fill', 'none').attr('stroke', color).attr('stroke-width', 1.5).attr('d', path)
}

function filterByOutliers(seq, wlo, whi, ctrl) {
  return seq.filter(k => {
    const isOut = k < wlo || k > whi
    return isOut ? ctrl.showOutliers : ctrl.showInliers
  })
}

// ── Render ─────────────────────────────────────────────────────────
function renderChart() {
  if (!chartContainer.value || !data.value?.degree_sequence) return
  d3.select(chartContainer.value).selectAll('*').remove()

  const v = view.value
  const isRank = v === 'Rank'
  const isCCDF = v === 'CCDF'
  const ctrl = controls.value
  const useLogX = !!ctrl.logX
  const useLogY = !!ctrl.logY

  const totalW = chartContainer.value.clientWidth || 800
  const totalH = chartContainer.value.clientHeight || Math.round(totalW * 3 / 4)
  const innerW = totalW - MARGINS.left - MARGINS.right
  const lineH  = totalH - MARGINS.top - MARGINS.bottom

  const svg = d3.select(chartContainer.value).append('svg').attr('width', totalW).attr('height', totalH)
  const tooltip = makeTooltip(chartContainer.value)
  const g = svg.append('g').attr('transform', `translate(${MARGINS.left},${MARGINS.top})`)

  const xLabel = isRank ? 'Rank' : 'Degree k'
  const yLabel = isRank ? 'Degree k' : isCCDF ? 'P(K ≥ k)' : 'P(k)'
  const buildFn = builderFor(v)

  // ── BY TYPE ──────────────────────────────────────────────────────
  if (ctrl.byType) {
    const byTypeRaw = data.value.degree_by_type || {}
    const types = Object.keys(byTypeRaw)
    const color = d3.scaleOrdinal(d3.schemeTableau10).domain(types)

    // pre-compute per-type filtered points and stats once (used for scale + draw)
    const perType = types.map(t => {
      const st = typeStats(byTypeRaw[t])
      const twlo = st?.wlo ?? -Infinity
      const twhi = st?.whi ?? Infinity
      const seq = filterByOutliers(byTypeRaw[t], twlo, twhi, ctrl)
      const pts = buildFn(seq).filter(d => !useLogX || d.k >= 1)
      return { t, st, twlo, twhi, pts }
    })

    const allPts = perType.flatMap(({ pts }) => pts)
    if (!allPts.length) return

    const { xScale, yScale } = buildScales(allPts, innerW, lineH, useLogX, useLogY, isRank)
    const tipFor = isRank
      ? d => `Rank ${d.k} → degree ${d.p}`
      : isCCDF
        ? d => `k = ${d.k}<br>P(K ≥ k) = ${FORMATTERS.percent(d.p)}`
        : d => `k = ${d.k}<br>P(k) = ${FORMATTERS.percent(d.p)}`

    perType.forEach(({ t, st, twlo, twhi, pts }) => {
      if (!pts.length) return
      drawLine(g, pts, xScale, yScale, color(t))

      g.selectAll(null).data(pts).join('circle')
        .attr('cx', d => xScale(d.k)).attr('cy', d => yScale(d.p))
        .attr('r', 2.5).attr('opacity', 0.7)
        .attr('fill', d => (ctrl.colorOutliers && !isRank && (d.k < twlo || d.k > twhi)) ? COLOR_SCHEME.error : color(t))
        .on('mouseover', function (e, d) {
          d3.select(this).attr('r', 5).attr('opacity', 1)
          showTip(tooltip, e, `<strong>${t}</strong><br>${tipFor(d)}`)
        })
        .on('mouseout', function () { d3.select(this).attr('r', 2.5).attr('opacity', 0.7); hideTip(tooltip) })

      if (isRank || !st) return
      const clamp = val => useLogX ? Math.max(1, val) : val

      if (ctrl.showMean && (!useLogX || st.mean >= 1)) {
        const x = xScale(clamp(st.mean))
        g.append('line').attr('x1', x).attr('x2', x).attr('y1', 0).attr('y2', lineH)
          .attr('stroke', color(t)).attr('stroke-width', 1.5).attr('stroke-dasharray', '4,3').attr('opacity', 0.8)
        attachVLineTooltip(g, x, lineH, `<strong>${t} — Mean</strong><br>${FORMATTERS.number(st.mean)}`, tooltip)
      }
      if (ctrl.showMedian && (!useLogX || st.median >= 1)) {
        const x = xScale(clamp(st.median))
        g.append('line').attr('x1', x).attr('x2', x).attr('y1', 0).attr('y2', lineH)
          .attr('stroke', color(t)).attr('stroke-width', 1.5).attr('stroke-dasharray', '2,3').attr('opacity', 0.8)
        attachVLineTooltip(g, x, lineH, `<strong>${t} — Median</strong><br>${FORMATTERS.number(st.median)}`, tooltip)
      }
      if (ctrl.showIqr && st.std > 0) {
        const lo = clamp(Math.max(0, st.mean - st.std)), hi = clamp(st.mean + st.std)
        if (!useLogX || lo >= 1) {
          g.append('rect')
            .attr('x', xScale(lo)).attr('width', Math.max(0, xScale(hi) - xScale(lo)))
            .attr('y', 0).attr('height', lineH)
            .attr('fill', color(t)).attr('opacity', 0.07).style('pointer-events', 'none')
        }
      }
    })

    // legend
    const legendX = innerW - 10
    types.forEach((t, i) => {
      const y = 12 + i * 16
      g.append('line').attr('x1', legendX - 20).attr('x2', legendX).attr('y1', y).attr('y2', y)
        .attr('stroke', color(t)).attr('stroke-width', 2)
      g.append('text').attr('x', legendX - 24).attr('y', y + 4)
        .attr('text-anchor', 'end').attr('font-size', '11px').attr('fill', color(t)).text(t)
    })

    drawAxes(g, xScale, yScale, innerW, lineH, useLogY, isRank, xLabel, yLabel)
    return
  }

  // ── PMF / CCDF / RANK ────────────────────────────────────────────
  const stats = data.value.degree_stats || {}
  const wlo = stats.whisker_lo ?? -Infinity
  const whi = stats.whisker_hi ?? Infinity

  const filteredSeq = filterByOutliers(data.value.degree_sequence, wlo, whi, ctrl)
  const points = buildFn(filteredSeq)
  const visible = useLogX ? points.filter(d => d.k >= 1) : points
  if (!visible.length) return

  const { xScale, yScale } = buildScales(visible, innerW, lineH, useLogX, useLogY, isRank)

  drawLine(g, visible, xScale, yScale, COLOR_SCHEME.accent)

  // stats overlay (not meaningful for Rank)
  if (!isRank && stats.mean != null) {
    const clamp = val => useLogX ? Math.max(1, val) : val

    if (ctrl.showIqr && stats.p25 != null && (!useLogX || stats.p25 >= 1)) {
      const xLo = xScale(clamp(stats.p25)), xHi = xScale(clamp(stats.p75))
      g.append('rect')
        .attr('x', xLo).attr('width', Math.max(0, xHi - xLo))
        .attr('y', 0).attr('height', lineH)
        .attr('fill', COLOR_SCHEME.accent).attr('opacity', 0.1).style('pointer-events', 'none')
    }
    if (ctrl.showMean && (!useLogX || stats.mean >= 1)) {
      const x = xScale(stats.mean)
      g.append('line').attr('x1', x).attr('x2', x).attr('y1', 0).attr('y2', lineH)
        .attr('stroke', COLOR_SCHEME.accent).attr('stroke-width', 1.5).attr('stroke-dasharray', '4,3')
      const tip = `<strong>Mean</strong><br>${FORMATTERS.number(stats.mean)}${stats.std != null ? `<br>Std: ${FORMATTERS.number(stats.std)}` : ''}`
      attachVLineTooltip(g, x, lineH, tip, tooltip)
    }
    if (ctrl.showMedian && (!useLogX || stats.median >= 1)) {
      const x = xScale(stats.median)
      g.append('line').attr('x1', x).attr('x2', x).attr('y1', 0).attr('y2', lineH)
        .attr('stroke', COLOR_SCHEME.success).attr('stroke-width', 1.5).attr('stroke-dasharray', '4,3')
      attachVLineTooltip(g, x, lineH, `<strong>Median</strong><br>${FORMATTERS.number(stats.median)}`, tooltip)
    }
  }

  // dots
  g.selectAll('.dot').data(visible).join('circle')
    .attr('class', 'dot')
    .attr('cx', d => xScale(d.k)).attr('cy', d => yScale(d.p))
    .attr('r', 2.5).attr('opacity', 0.7)
    .attr('fill', d => (ctrl.colorOutliers && !isRank && (d.k < wlo || d.k > whi)) ? COLOR_SCHEME.error : COLOR_SCHEME.accent)
    .on('mouseover', function (e, d) {
      const isOut = !isRank && (d.k < wlo || d.k > whi)
      d3.select(this).attr('r', 5).attr('opacity', 1)
      const outTag = isOut ? '<br><span style="color:#ef4444">outlier</span>' : ''
      const html = isRank
        ? `Rank ${d.k}<br>Degree = ${d.p}`
        : isCCDF
          ? `k = ${d.k}<br>P(K ≥ k) = ${FORMATTERS.percent(d.p)}${outTag}`
          : `k = ${d.k}<br>P(k) = ${FORMATTERS.percent(d.p)}${outTag}`
      showTip(tooltip, e, html)
    })
    .on('mouseout', function () { d3.select(this).attr('r', 2.5).attr('opacity', 0.7); hideTip(tooltip) })

  drawAxes(g, xScale, yScale, innerW, lineH, useLogY, isRank, xLabel, yLabel)
}
</script>

<template>
  <div class="flex flex-col gap-2">
    <!-- row 1: style + breakdown (pill toggles, change plot semantics) -->
    <div class="flex items-end px-3 py-2 text-[11px] text-slate-500">
      <div class="flex-1 flex flex-col items-center gap-1.5">
        <span class="uppercase tracking-wide text-[10px] text-slate-400">Style</span>
        <div class="flex rounded-md border border-slate-200 overflow-hidden text-[11px] font-medium">
          <button
            v-for="opt in VIEWS"
            :key="opt"
            class="px-2.5 py-1 transition-colors"
            :class="view === opt ? 'bg-sky-600 text-white' : 'bg-white text-slate-500 hover:bg-slate-50'"
            @click="view = opt"
          >{{ opt }}</button>
        </div>
      </div>
      <div class="flex-1 flex flex-col items-center gap-1.5">
        <span class="uppercase tracking-wide text-[10px] text-slate-400">Breakdown</span>
        <div class="flex rounded-md border border-slate-200 overflow-hidden text-[11px] font-medium">
          <button
            v-for="opt in [{ k: false, label: 'All' }, { k: true, label: 'By type' }]"
            :key="opt.label"
            class="px-2.5 py-1 transition-colors"
            :class="controls.byType === opt.k ? 'bg-sky-600 text-white' : 'bg-white text-slate-500 hover:bg-slate-50'"
            @click="updateControl('byType', opt.k)"
          >{{ opt.label }}</button>
        </div>
      </div>
    </div>

    <!-- row 2: scale + data + overlay (additive modifiers) -->
    <div class="flex justify-between gap-4 px-3 pb-2 text-[11px] text-slate-500">
      <div class="flex flex-col gap-1">
        <span class="uppercase tracking-wide text-[10px] text-slate-400">Scale</span>
        <ControlSwitch label="Log X" :model-value="controls.logX" @update:model-value="updateControl('logX', $event)" />
        <ControlSwitch label="Log Y" :model-value="controls.logY" @update:model-value="updateControl('logY', $event)" />
      </div>
      <div class="flex flex-col gap-1">
        <span class="uppercase tracking-wide text-[10px] text-slate-400">Data</span>
        <ControlSwitch label="Outliers" :model-value="controls.showOutliers" @update:model-value="updateControl('showOutliers', $event)" />
        <ControlSwitch label="Inliers" :model-value="controls.showInliers" @update:model-value="updateControl('showInliers', $event)" />
        <ControlSwitch label="Color outliers" :model-value="controls.colorOutliers" @update:model-value="updateControl('colorOutliers', $event)" />
      </div>
      <div class="flex flex-col gap-1">
        <span class="uppercase tracking-wide text-[10px] text-slate-400">Overlay</span>
        <ControlSwitch label="Mean" :model-value="controls.showMean" @update:model-value="updateControl('showMean', $event)" />
        <ControlSwitch label="Median" :model-value="controls.showMedian" @update:model-value="updateControl('showMedian', $event)" />
        <ControlSwitch label="IQR / ±1σ" :model-value="controls.showIqr" @update:model-value="updateControl('showIqr', $event)" />
      </div>
    </div>

    <!-- chart -->
    <div v-if="loading" class="text-sm text-slate-500 p-3 bg-slate-50 rounded">Loading metrics…</div>
    <div v-if="error" class="text-sm text-red-600 p-3 bg-red-50 rounded border border-red-200">{{ error }}</div>
    <div ref="chartContainer" class="w-full bg-white rounded-lg border border-slate-200" style="aspect-ratio: 4/3; position: relative;"></div>
  </div>
</template>
