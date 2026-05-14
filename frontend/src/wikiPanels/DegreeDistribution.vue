<script setup>
import { ref, watch, toRef, computed } from 'vue'
import * as d3 from 'd3'
import { useMetrics } from '@/composables/useMetrics'
import { useDegreeFit } from '@/composables/useDegreeFit'
import { useNodeTypeColors } from '@/composables/useNodeTypeColors'
import {
  FORMATTERS, COLOR_SCHEME, applyOutlierEncoding, summaryStats,
  makeTooltip, showTip, hideTip, attachVLineTooltip,
  drawGrid, drawAxes, drawLine,
} from './shared.js'
import { usePanel } from './usePanel.js'
import { useD3Chart } from './useD3Chart.js'
import ControlSwitch from './controls/ControlSwitch.vue'
import ControlBoolean from './controls/ControlBoolean.vue'
import ControlSection from './controls/ControlSection.vue'
import ControlToggleGroup from './controls/ControlToggleGroup.vue'

const props = defineProps({
  panelSpec: { type: Object, required: true },
  schema: { type: Object, default: null },
  graphId: { type: String, default: null },
  showExplanation: { type: Boolean, default: false },
  controlsTarget: { type: String, default: null },
})

const { metrics: data, loading, error } = useMetrics(toRef(props, 'graphId'))
const { fit } = useDegreeFit(toRef(props, 'graphId'))
const { color: typeColor } = useNodeTypeColors(toRef(props, 'schema'))
const { controls, updateControl } = usePanel(props, 'degree', data)
const chartContainer = ref(null)
const view = ref('CCDF')

const fitVisible = ref({ powerlaw: false, exponential: false, poisson: false, lognormal: false })
let bestFitAutoSet = false

// Per-type subsets used in by-type mode. null = "all types" (default until
// the user explicitly restricts the scope). Keeping null instead of an array
// of all types means the selection auto-tracks new types without being stale.
const overlayTypes = ref(null)
const fitTypes = ref(null)

const FIT_LABELS = { powerlaw: 'Power law', exponential: 'Exponential', poisson: 'Poisson', lognormal: 'Log-normal' }

function toggleOverlayType(t) {
  const all = availableTypes.value
  const cur = overlayTypes.value === null ? new Set(all) : new Set(overlayTypes.value)
  if (cur.has(t)) cur.delete(t); else cur.add(t)
  overlayTypes.value = cur.size === all.length ? null : Array.from(cur)
}

function toggleFitType(t) {
  const all = availableTypes.value
  const cur = fitTypes.value === null ? new Set(all) : new Set(fitTypes.value)
  if (cur.has(t)) cur.delete(t); else cur.add(t)
  fitTypes.value = cur.size === all.length ? null : Array.from(cur)
}

function isOverlayOn(t) {
  return overlayTypes.value === null || overlayTypes.value.includes(t)
}

function isFitOn(t) {
  return fitTypes.value === null || fitTypes.value.includes(t)
}

const availableTypes = computed(() => Object.keys(data.value?.degree_by_type || {}))

// Aggregate per-point log-likelihood for ranking fits.
// All four families are fitted on the full sequence (xmin=1) server-side,
// so ll values share support and are directly comparable.
// By-type: weighted mean of per-type ll by group size n_t — equivalent to
// joint LL per point under independence.
function aggregateLL(name) {
  if (controls.value.byType) {
    const byType = fit.value?.by_type
    const sizes = data.value?.degree_by_type
    if (!byType || !sizes) return null
    let llSum = 0, nSum = 0
    for (const t of Object.keys(byType)) {
      const ll = byType[t]?.[name]?.ll
      const n = sizes[t]?.length
      if (ll != null && Number.isFinite(ll) && n) { llSum += ll * n; nSum += n }
    }
    return nSum ? llSum / nSum : null
  }
  return fit.value?.all?.[name]?.ll ?? null
}

const fitSwitches = computed(() => {
  // depend on fit + byType so the order recomputes when the mode flips
  fit.value
  controls.value.byType
  const entries = Object.keys(FIT_LABELS).map(name => ({
    name,
    label: FIT_LABELS[name],
    ll: aggregateLL(name),
  }))
  entries.sort((a, b) => {
    if (a.ll == null && b.ll == null) return 0
    if (a.ll == null) return 1
    if (b.ll == null) return -1
    return b.ll - a.ll
  })
  return entries
})

const VIEWS = ['PMF', 'CCDF']
const VIEW_OPTIONS = VIEWS.map(v => ({ k: v, label: v }))
const BY_TYPE_OPTIONS = [{ k: false, label: 'All' }, { k: true, label: 'By type' }]
const Y_AXIS_OPTIONS = [{ k: 'count', label: 'Count' }, { k: 'probability', label: 'Prob.' }]
const MARGINS = { top: 8, right: 12, bottom: 38, left: 44 }

watch(fit, (f) => {
  if (bestFitAutoSet || !f?.all) return
  const ranked = Object.entries(f.all)
    .filter(([, v]) => v?.ll != null)
    .sort((a, b) => b[1].ll - a[1].ll)
  if (ranked.length) {
    fitVisible.value[ranked[0][0]] = true
    bestFitAutoSet = true
  }
}, { immediate: true })

watch([data, fit, controls, view, fitVisible, overlayTypes, fitTypes], renderChart, { deep: true })

useD3Chart(chartContainer, renderChart)

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

function builderFor(viewName) {
  return viewName === 'CCDF' ? buildCCDF : buildPMF
}

function buildScales(visible, innerW, lineH, useLogX, useLogY) {
  const minK = useLogX ? Math.max(1, d3.min(visible, d => d.k)) : d3.min(visible, d => d.k)
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

// ── Theoretical curves ────────────────────────────────────────────
// All four families are fitted server-side on the full degree sequence
// (xmin=1) — pmf is normalised over the same support as the data, so
// scaling to counts is just `* n`.
// In "All" mode, fit family is encoded via color; in "By type" mode color is
// reserved for node type so fit family is encoded via dash style.
// Fit family encoding — stable across plots and rank order.
// Dash patterns picked for visual distance at small line-widths:
//   power law: solid          (baseline of network science)
//   exponential: long dashes  (regular decay → regular segments)
//   log-normal: dash-dot      (mixed distribution → mixed pattern)
//   poisson: fine dots        (concentrated, discrete → minimal pattern)
const FIT_COLORS = { powerlaw: '#ef4444', exponential: '#f97316', poisson: '#8b5cf6', lognormal: '#06b6d4' }
const FIT_DASHES = { powerlaw: null, exponential: '10,4', lognormal: '10,3,2,3', poisson: '1,3' }
const FIT_NAMES = ['powerlaw', 'exponential', 'poisson', 'lognormal']

function drawFitCurves(g, fitParams, xScale, yScale, isCCDF, n, yMode, useLogX, visibleMap, colorOverride = null) {
  if (!fitParams) return
  for (const name of FIT_NAMES) {
    if (!visibleMap[name] || !fitParams[name]) continue
    const { grid, pmf, ccdf } = fitParams[name]
    if (!grid || !grid.length) continue
    const probs = isCCDF ? ccdf : pmf
    const scale = yMode === 'count' ? n : 1
    const pts = []
    for (let i = 0; i < grid.length; i++) {
      const k = grid[i]
      const p = probs[i] * scale
      if (!isFinite(p) || p <= 0) continue
      if (useLogX && k < 1) continue
      if (!isFinite(xScale(k)) || !isFinite(yScale(p))) continue
      pts.push({ k, p })
    }
    if (pts.length < 2) continue
    const color = colorOverride ?? FIT_COLORS[name]
    // In All mode powerlaw has no dash (FIT_DASHES.powerlaw=null) → solid line.
    // Override to a thin dashed style so it stays visually distinct from data dots.
    const dash = FIT_DASHES[name] ?? '5,4'
    drawLine(g, pts, xScale, yScale, color, dash)
  }
}


// ── Render ─────────────────────────────────────────────────────────
function renderChart() {
  if (!chartContainer.value || !data.value?.degree_sequence) return
  d3.select(chartContainer.value).selectAll('*').remove()

  const v = view.value
  const isCCDF = v === 'CCDF'
  const ctrl = controls.value
  const useLogX = !!ctrl.logX
  const useLogY = !!ctrl.logY
  const yMode = ctrl.yAxis === 'count' ? 'count' : 'probability'
  const scaleP = (pts, n) => yMode === 'count' ? pts.map(d => ({ k: d.k, p: d.p * n })) : pts
  const fmtY = yMode === 'count' ? FORMATTERS.number : FORMATTERS.percent

  const totalW = chartContainer.value.clientWidth || 800
  const totalH = chartContainer.value.clientHeight || Math.round(totalW * 3 / 4)
  const innerW = totalW - MARGINS.left - MARGINS.right
  const lineH  = totalH - MARGINS.top - MARGINS.bottom

  const svg = d3.select(chartContainer.value).append('svg').attr('width', totalW).attr('height', totalH)
  const tooltip = makeTooltip(chartContainer.value)
  const g = svg.append('g').attr('transform', `translate(${MARGINS.left},${MARGINS.top})`)

  const xLabel = 'Degree k'
  const yLabel = yMode === 'count'
    ? (isCCDF ? 'Count (K ≥ k)' : 'Count')
    : (isCCDF ? 'P(K ≥ k)' : 'P(k)')
  const buildFn = builderFor(v)

  // ── BY TYPE ──────────────────────────────────────────────────────
  if (ctrl.byType) {
    const byTypeRaw = data.value.degree_by_type || {}
    const types = Object.keys(byTypeRaw)
    // Use the shared schema-scoped mapping so types share colors across panels.
    const color = typeColor

    // pre-compute per-type filtered points and stats once (used for scale + draw)
    const perType = types.map(t => {
      const st = summaryStats(byTypeRaw[t])
      const seq = byTypeRaw[t]
      const pts = scaleP(buildFn(seq), seq.length).filter(d => !useLogX || d.k >= 1)
      return { t, st, pts }
    })

    const allPts = perType.flatMap(({ pts }) => pts)
    if (!allPts.length) return

    const { xScale, yScale } = buildScales(allPts, innerW, lineH, useLogX, useLogY)
    drawGrid(g, xScale, yScale, innerW, lineH)
    const yLab = yMode === 'count' ? (isCCDF ? 'Count(K ≥ k)' : 'Count') : (isCCDF ? 'P(K ≥ k)' : 'P(k)')
    const tipFor = d => `k = ${d.k}<br>${yLab} = ${fmtY(d.p)}`

    perType.forEach(({ t, st, pts }) => {
      if (!pts.length) return

      const tWlo = st?.wlo ?? -Infinity
      const tWhi = st?.whi ?? Infinity
      const tIsInlier = d => ctrl.showOutliers && (d.k >= tWlo && d.k <= tWhi)
      applyOutlierEncoding(
        g.selectAll(null).data(pts).join('circle')
          .attr('cx', d => xScale(d.k)).attr('cy', d => yScale(d.p))
          .attr('fill', color(t)),
        tIsInlier
      )
        .on('mouseover', function (_, d) {
          d3.select(this).attr('r', 4)
          showTip(tooltip, _, `<strong>${t}</strong><br>${tipFor(d)}`)
        })
        .on('mouseout', function () { d3.select(this).attr('r', 3); hideTip(tooltip) })


      if (!st) return
      const clamp = val => useLogX ? Math.max(1, val) : val
      const overlayOn = isOverlayOn(t)

      if (overlayOn && ctrl.showMean && (!useLogX || st.mean >= 1)) {
        const x = xScale(clamp(st.mean))
        g.append('line').attr('x1', x).attr('x2', x).attr('y1', 0).attr('y2', lineH)
          .attr('stroke', color(t)).attr('stroke-width', 1).attr('stroke-dasharray', '4,3').attr('opacity', 0.55)
        attachVLineTooltip(g, x, lineH, `<strong>${t} — Mean</strong><br>${FORMATTERS.number(st.mean)}`, tooltip)
      }
      if (overlayOn && ctrl.showMedian && (!useLogX || st.median >= 1)) {
        const x = xScale(clamp(st.median))
        g.append('line').attr('x1', x).attr('x2', x).attr('y1', 0).attr('y2', lineH)
          .attr('stroke', color(t)).attr('stroke-width', 1).attr('stroke-dasharray', '2,3').attr('opacity', 0.55)
        attachVLineTooltip(g, x, lineH, `<strong>${t} — Median</strong><br>${FORMATTERS.number(st.median)}`, tooltip)
      }
      if (overlayOn && ctrl.showIqr && st.p25 != null && st.p75 > st.p25) {
        const lo = clamp(st.p25), hi = clamp(st.p75)
        if (!useLogX || lo >= 1) {
          g.append('rect')
            .attr('x', xScale(lo)).attr('width', Math.max(0, xScale(hi) - xScale(lo)))
            .attr('y', 0).attr('height', lineH)
            .attr('fill', color(t)).attr('opacity', 0.08).style('pointer-events', 'none')
        }
      }
    })

    // legend — circles (match dot appearance)
    const legendX = innerW - 10
    types.forEach((t, i) => {
      const y = 12 + i * 16
      g.append('circle').attr('cx', legendX - 5).attr('cy', y).attr('r', 3)
        .attr('fill', color(t)).attr('opacity', ctrl.showOutliers ? 0.45 : 1.0)
      g.append('text').attr('x', legendX - 12).attr('y', y + 4)
        .attr('text-anchor', 'end').attr('font-size', '11px').attr('fill', color(t)).text(t)
    })

    const fitByType = fit.value?.by_type || {}
    perType.forEach(({ t, pts }) => {
      if (!pts.length) return
      if (!isFitOn(t)) return
      drawFitCurves(g, fitByType[t], xScale, yScale, isCCDF, byTypeRaw[t].length, yMode, useLogX, fitVisible.value, color(t))
    })

    // legend extension: fits (dash style) + overlays (mean/median/IQR).
    // All neutral grey — color is already spent on type encoding above.
    let extY = 12 + types.length * 16
    const visibleFits = FIT_NAMES.filter(n => fitVisible.value[n])
    visibleFits.forEach((name) => {
      g.append('line')
        .attr('x1', legendX - 14).attr('x2', legendX)
        .attr('y1', extY).attr('y2', extY)
        .attr('stroke', '#64748b').attr('stroke-width', 1.5)
        .attr('stroke-dasharray', FIT_DASHES[name] ?? '5,4')
        .attr('stroke-linecap', 'round').attr('opacity', 0.9)
      g.append('text').attr('x', legendX - 18).attr('y', extY + 4)
        .attr('text-anchor', 'end').attr('font-size', '11px').attr('fill', '#64748b').text(FIT_LABELS[name])
      extY += 16
    })
    if (ctrl.showIqr) {
      g.append('rect').attr('x', legendX - 14).attr('y', extY - 4).attr('width', 14).attr('height', 8)
        .attr('fill', '#64748b').attr('opacity', 0.15)
      g.append('text').attr('x', legendX - 18).attr('y', extY + 4)
        .attr('text-anchor', 'end').attr('font-size', '11px').attr('fill', '#64748b').text('IQR')
      extY += 16
    }
    if (ctrl.showMean) {
      g.append('line').attr('x1', legendX - 7).attr('x2', legendX - 7).attr('y1', extY - 5).attr('y2', extY + 5)
        .attr('stroke', '#64748b').attr('stroke-width', 1).attr('stroke-dasharray', '4,3').attr('opacity', 0.7)
      g.append('text').attr('x', legendX - 18).attr('y', extY + 4)
        .attr('text-anchor', 'end').attr('font-size', '11px').attr('fill', '#64748b').text('Mean')
      extY += 16
    }
    if (ctrl.showMedian) {
      g.append('line').attr('x1', legendX - 7).attr('x2', legendX - 7).attr('y1', extY - 5).attr('y2', extY + 5)
        .attr('stroke', '#64748b').attr('stroke-width', 1).attr('stroke-dasharray', '2,3').attr('opacity', 0.7)
      g.append('text').attr('x', legendX - 18).attr('y', extY + 4)
        .attr('text-anchor', 'end').attr('font-size', '11px').attr('fill', '#64748b').text('Median')
      extY += 16
    }

    drawAxes(g, xScale, yScale, innerW, lineH, {
      xLabel, yLabel,
      yTickFmt: useLogY ? (yMode === 'count' ? '~s' : '.0e') : (yMode === 'count' ? 'd' : '.0%'),
    })
    return
  }

  // ── PMF / CCDF ────────────────────────────────────────────────────
  const stats = data.value.degree_stats || {}
  const filteredSeq = data.value.degree_sequence
  const points = scaleP(buildFn(filteredSeq), filteredSeq.length)
  const visible = useLogX ? points.filter(d => d.k >= 1) : points
  if (!visible.length) return

  const { xScale, yScale } = buildScales(visible, innerW, lineH, useLogX, useLogY)
  drawGrid(g, xScale, yScale, innerW, lineH)

  if (stats.mean != null) {
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
        .attr('stroke', COLOR_SCHEME.accent).attr('stroke-width', 1).attr('stroke-dasharray', '4,3').attr('opacity', 0.55)
      const tip = `<strong>Mean</strong><br>${FORMATTERS.number(stats.mean)}${stats.std != null ? `<br>Std: ${FORMATTERS.number(stats.std)}` : ''}`
      attachVLineTooltip(g, x, lineH, tip, tooltip)
    }
    if (ctrl.showMedian && (!useLogX || stats.median >= 1)) {
      const x = xScale(stats.median)
      g.append('line').attr('x1', x).attr('x2', x).attr('y1', 0).attr('y2', lineH)
        .attr('stroke', COLOR_SCHEME.success).attr('stroke-width', 1).attr('stroke-dasharray', '4,3').attr('opacity', 0.55)
      attachVLineTooltip(g, x, lineH, `<strong>Median</strong><br>${FORMATTERS.number(stats.median)}`, tooltip)
    }
  }

  // dots
  const wlo = stats.whisker_lo ?? -Infinity
  const whi = stats.whisker_hi ?? Infinity
  const isInlier = d => ctrl.showOutliers && (d.k >= wlo && d.k <= whi)
  applyOutlierEncoding(
    g.selectAll('.dot').data(visible).join('circle')
      .attr('class', 'dot')
      .attr('cx', d => xScale(d.k)).attr('cy', d => yScale(d.p))
      .attr('fill', COLOR_SCHEME.accent),
    isInlier
  )
    .on('mouseover', function (_, d) {
      d3.select(this).attr('r', 4)
      const yLab = yMode === 'count' ? (isCCDF ? 'Count(K ≥ k)' : 'Count') : (isCCDF ? 'P(K ≥ k)' : 'P(k)')
      showTip(tooltip, _, `k = ${d.k}<br>${yLab} = ${fmtY(d.p)}`)
    })
    .on('mouseout', function () { d3.select(this).attr('r', 3); hideTip(tooltip) })

  drawFitCurves(g, fit.value?.all, xScale, yScale, isCCDF, filteredSeq.length, yMode, useLogX, fitVisible.value)

  // legend (All mode)
  const legendItems = [{ kind: 'dot', color: COLOR_SCHEME.accent, label: 'Data' }]
  for (const name of FIT_NAMES) {
    if (fitVisible.value[name]) legendItems.push({ kind: 'line', color: FIT_COLORS[name], dash: FIT_DASHES[name] ?? '5,4', label: FIT_LABELS[name] })
  }
  // overlay entries — match the visual style used in the plot
  if (ctrl.showIqr && stats.p25 != null) {
    legendItems.push({ kind: 'rect', color: COLOR_SCHEME.accent, label: 'IQR' })
  }
  if (ctrl.showMean && stats.mean != null) {
    legendItems.push({ kind: 'vline', color: COLOR_SCHEME.accent, label: 'Mean' })
  }
  if (ctrl.showMedian && stats.median != null) {
    legendItems.push({ kind: 'vline', color: COLOR_SCHEME.success, label: 'Median' })
  }

  if (legendItems.length > 1) {
    const lx = innerW - 8
    legendItems.forEach(({ kind, color, dash, label }, i) => {
      const ly = 10 + i * 16
      if (kind === 'line') {
        g.append('line').attr('x1', lx - 14).attr('x2', lx).attr('y1', ly).attr('y2', ly)
          .attr('stroke', color).attr('stroke-width', 1.5).attr('stroke-dasharray', dash).attr('stroke-linecap', 'round').attr('opacity', 0.85)
      } else if (kind === 'vline') {
        g.append('line').attr('x1', lx - 7).attr('x2', lx - 7).attr('y1', ly - 5).attr('y2', ly + 5)
          .attr('stroke', color).attr('stroke-width', 1).attr('stroke-dasharray', '4,3').attr('opacity', 0.7)
      } else if (kind === 'rect') {
        g.append('rect').attr('x', lx - 14).attr('y', ly - 4).attr('width', 14).attr('height', 8)
          .attr('fill', color).attr('opacity', 0.15)
      } else {
        g.append('circle').attr('cx', lx - 7).attr('cy', ly).attr('r', 3)
          .attr('fill', color).attr('opacity', ctrl.showOutliers ? 0.45 : 1.0)
      }
      g.append('text').attr('x', lx - 18).attr('y', ly + 4)
        .attr('text-anchor', 'end').attr('font-size', '11px').attr('fill', '#64748b').text(label)
    })
  }

  drawAxes(g, xScale, yScale, innerW, lineH, {
    xLabel, yLabel,
    yTickFmt: useLogY ? (yMode === 'count' ? '~s' : '.0e') : (yMode === 'count' ? 'd' : '.0%'),
  })
}
</script>

<template>
  <div class="flex flex-col gap-1.5">
    <Teleport v-if="controlsTarget" :to="`#${controlsTarget}`">
      <div class="grid grid-cols-2 auto-rows-min gap-2">
        <ControlSection title="View">
          <div class="flex flex-col gap-1">
            <ControlToggleGroup :model-value="view" :options="VIEW_OPTIONS" @update:model-value="view = $event" />
            <ControlToggleGroup :model-value="controls.byType" :options="BY_TYPE_OPTIONS" @update:model-value="updateControl('byType', $event)" />
            <ControlToggleGroup :model-value="controls.yAxis" :options="Y_AXIS_OPTIONS" @update:model-value="updateControl('yAxis', $event)" />
          </div>
        </ControlSection>

        <ControlSection title="Scale">
          <ControlSwitch label="Log X" :model-value="controls.logX" @update:model-value="updateControl('logX', $event)" />
          <ControlSwitch label="Log Y" :model-value="controls.logY" @update:model-value="updateControl('logY', $event)" />
        </ControlSection>

        <ControlSection title="Overlay">
          <ControlBoolean label="Mean" :model-value="controls.showMean" @update:model-value="updateControl('showMean', $event)" />
          <ControlBoolean label="Median" :model-value="controls.showMedian" @update:model-value="updateControl('showMedian', $event)" />
          <ControlBoolean label="IQR" :model-value="controls.showIqr" @update:model-value="updateControl('showIqr', $event)" />
          <ControlBoolean label="Outliers" :model-value="controls.showOutliers" @update:model-value="updateControl('showOutliers', $event)" />
          <div v-if="controls.byType && availableTypes.length > 1" class="flex flex-col gap-1 pt-1 border-t border-slate-100">
            <span class="text-[9px] font-medium text-slate-400 uppercase tracking-wider">Show for</span>
            <div class="flex flex-wrap gap-1">
              <button v-for="t in availableTypes" :key="t"
                class="rounded-full border px-1.5 py-0 text-[10px] transition-colors"
                :class="isOverlayOn(t)
                  ? 'border-sky-500 bg-sky-50 text-sky-700'
                  : 'border-slate-200 bg-white text-slate-400 hover:border-slate-300'"
                @click="toggleOverlayType(t)">{{ t }}</button>
            </div>
          </div>
        </ControlSection>

        <ControlSection title="Fit — best first">
          <ControlBoolean
            v-for="s in fitSwitches" :key="s.name"
            :label="s.label"
            :model-value="fitVisible[s.name]"
            @update:model-value="fitVisible[s.name] = $event" />
          <div v-if="controls.byType && availableTypes.length > 1" class="flex flex-col gap-1 pt-1 border-t border-slate-100">
            <span class="text-[9px] font-medium text-slate-400 uppercase tracking-wider">Show for</span>
            <div class="flex flex-wrap gap-1">
              <button v-for="t in availableTypes" :key="t"
                class="rounded-full border px-1.5 py-0 text-[10px] transition-colors"
                :class="isFitOn(t)
                  ? 'border-sky-500 bg-sky-50 text-sky-700'
                  : 'border-slate-200 bg-white text-slate-400 hover:border-slate-300'"
                @click="toggleFitType(t)">{{ t }}</button>
            </div>
          </div>
        </ControlSection>
      </div>
    </Teleport>

    <!-- chart -->
    <div v-if="loading" class="text-sm text-slate-500 p-3 bg-slate-50 rounded">Loading metrics…</div>
    <div v-if="error" class="text-sm text-red-600 p-3 bg-red-50 rounded border border-red-200">{{ error }}</div>
    <div ref="chartContainer" class="w-full" style="aspect-ratio: 4/3; position: relative;"></div>
  </div>
</template>
