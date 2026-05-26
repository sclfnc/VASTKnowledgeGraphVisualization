<script setup>
import { ref, watch, toRef, computed } from 'vue'
import * as d3 from 'd3'
import { useGraphNodes } from '@/composables/useGraphNodes.js'
import { useDegreeFit } from '@/composables/useDegreeFit.js'
import { useNodeTypeColors } from '@/composables/useNodeTypeColors.js'
import { usePanelContextFromProps } from '@/composables/usePanelContext.js'
import { useSelectionStore } from '@/stores/selection.js'
import {
  FORMATTERS, COLOR_SCHEME, applyOutlierEncoding, summaryStats,
  makeTooltip, showTip, hideTip, attachVLineTooltip,
  drawGrid, drawAxes, drawLine,
} from './shared.js'
import { usePanel } from './usePanel.js'
import { useD3Chart } from './useD3Chart.js'
import ControlBoolean from './controls/ControlBoolean.vue'
import ControlToggleGroup from './controls/ControlToggleGroup.vue'

const props = defineProps({
  panelSpec: { type: Object, required: true },
  schema: { type: Object, default: null },
  graphId: { type: String, default: null },
  controlsTarget: { type: String, default: null },
})

// Histogram derived live from SoA; fits stay anchored to the full graph (CSN framework).
const { nodes, loading, error } = useGraphNodes(toRef(props, 'graphId'))
const { data: fit } = useDegreeFit(toRef(props, 'graphId'))
const { activeNodeMask, selectedMask, edgeFilterActive, noNodesActive } = usePanelContextFromProps(props)
const selection = useSelectionStore()
const { color: typeColor } = useNodeTypeColors(toRef(props, 'schema'))

// baseline = full graph, active = global mask; both rebuilt O(N) per change.
const baselineData = computed(() => {
  const soa = nodes.value
  if (!soa) return null
  const seq = Array.from(soa.degrees)
  const byType = {}
  for (let i = 0; i < soa.N; i++) {
    const t = soa.types[i]
    ;(byType[t] ??= []).push(soa.degrees[i])
  }
  return { seq, byType, stats: summaryStats(seq) }
})

const activeData = computed(() => {
  const soa = nodes.value
  const mask = activeNodeMask.value
  if (!soa || !mask) return null
  const seq = []
  const byType = {}
  for (let i = 0; i < soa.N; i++) {
    if (!mask.get(i)) continue
    const d = soa.degrees[i]
    seq.push(d)
    const t = soa.types[i]
    ;(byType[t] ??= []).push(d)
  }
  return { seq, byType, stats: summaryStats(seq) }
})

// Highlight rings: byType for By-type mode, all (flat Set) for Total mode.
const selectedDegrees = computed(() => {
  const soa = nodes.value
  const sm = selectedMask.value
  if (!soa || !sm) return null
  const byType = new Map()
  const all = new Set()
  for (let i = 0; i < soa.N; i++) {
    if (!sm.get(i)) continue
    const d = soa.degrees[i]
    const t = soa.types[i]
    if (!byType.has(t)) byType.set(t, new Set())
    byType.get(t).add(d)
    all.add(d)
  }
  return { byType, all }
})

const { controls, updateControl } = usePanel(props, 'degree', activeData)
const chartContainer = ref(null)
const view = ref('CCDF')

const fitVisible = ref({ powerlaw: false, exponential: false, poisson: false, lognormal: false })
let bestFitAutoSet = false

// null = "all types" so the set auto-tracks new types without going stale.
const overlayTypes = ref(null)
const fitTypes = ref(null)

const FIT_LABELS = { powerlaw: 'Power law', exponential: 'Exponential', poisson: 'Poisson', lognormal: 'Log-normal' }

// True when the global filter has narrowed the subset; triggers the baseline overlay.
const isSubsetActive = computed(() => {
  const a = activeData.value, b = baselineData.value
  return !!(a && b && a.seq.length < b.seq.length)
})

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

const availableTypes = computed(() => Object.keys(baselineData.value?.byType || {}))

// All families fitted on full sequence xmin=1 → ll comparable; by-type uses size-weighted mean.
function aggregateLL(name) {
  if (controls.value.byType) {
    const byType = fit.value?.by_type
    const sizes = baselineData.value?.byType
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
  // Read fit + byType so the computed re-evaluates when either changes.
  void fit.value
  void controls.value.byType
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
const BY_TYPE_OPTIONS = [{ k: false, label: 'Total' }, { k: true, label: 'Per type' }]
const Y_AXIS_OPTIONS = [{ k: 'count', label: 'Count' }, { k: 'probability', label: 'Prob.' }]
const SCALE_OPTIONS = [{ k: 'lin', label: 'Lin' }, { k: 'log', label: 'Log' }]
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

watch([activeData, baselineData, selectedDegrees, fit, controls, view, fitVisible, overlayTypes, fitTypes], renderChart, { deep: true })

useD3Chart(chartContainer, renderChart)

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

// Fitted on full sequence xmin=1: pmf normalised over data support → count scale = * n.
// All mode encodes family via color; By type encodes via dash style (color is reserved for type).
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
    // Powerlaw is solid in All mode; force dashed here so it stays distinct from data dots.
    const dash = FIT_DASHES[name] ?? '5,4'
    drawLine(g, pts, xScale, yScale, color, dash)
  }
}


// Grey baseline overlay; hidden when active == baseline to avoid clutter.
const BASELINE_COLOR = '#94a3b8'   // slate-400
const BASELINE_LINE_OPACITY = 0.4
const BASELINE_RECT_OPACITY = 0.06

function selectIdsForBin(k, type = null) {
  const soa = nodes.value
  const mask = activeNodeMask.value
  if (!soa || !mask) return
  const ids = []
  for (let i = 0; i < soa.N; i++) {
    if (!mask.get(i)) continue
    if (soa.degrees[i] !== k) continue
    if (type && soa.types[i] !== type) continue
    ids.push(soa.ids[i])
  }
  selection.replace(ids)
}

function renderChart() {
  if (!chartContainer.value || !activeData.value || !baselineData.value) return
  d3.select(chartContainer.value).selectAll('*').remove()

  const v = view.value
  const isCCDF = v === 'CCDF'
  const ctrl = controls.value
  const useLogX = ctrl.scale === 'log'
  const useLogY = ctrl.scale === 'log'
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

  // By-type branch.
  if (ctrl.byType) {
    // Iterate baseline types so a fully-masked type stays legible.
    const activeByType = activeData.value.byType
    const baselineByType = baselineData.value.byType
    const types = Object.keys(baselineByType)
    const color = typeColor
    const selByType = selectedDegrees.value?.byType ?? new Map()

    // perType holds both active + baseline per type; subset triggers baseline overlay.
    const perType = types.map(t => {
      const activeSeq = activeByType[t] ?? []
      const baselineSeq = baselineByType[t] ?? []
      const st = activeSeq.length ? summaryStats(activeSeq) : null
      const stBase = baselineSeq.length ? summaryStats(baselineSeq) : null
      const pts = activeSeq.length
        ? scaleP(buildFn(activeSeq), activeSeq.length).filter(d => !useLogX || d.k >= 1)
        : []
      return { t, st, stBase, pts, activeN: activeSeq.length, baselineN: baselineSeq.length }
    })

    const allPts = perType.flatMap(({ pts }) => pts)
    if (!allPts.length) return

    const { xScale, yScale } = buildScales(allPts, innerW, lineH, useLogX, useLogY)
    drawGrid(g, xScale, yScale, innerW, lineH)
    const yLab = yMode === 'count' ? (isCCDF ? 'Count(K ≥ k)' : 'Count') : (isCCDF ? 'P(K ≥ k)' : 'P(k)')
    const tipFor = d => `k = ${d.k}<br>${yLab} = ${fmtY(d.p)}`

    perType.forEach(({ t, st, stBase, pts, activeN, baselineN }) => {
      if (!pts.length) return

      const tWlo = st?.wlo ?? -Infinity
      const tWhi = st?.whi ?? Infinity
      const tIsInlier = d => ctrl.showOutliers && (d.k >= tWlo && d.k <= tWhi)
      const selSet = selByType.get(t)
      applyOutlierEncoding(
        g.selectAll(null).data(pts).join('circle')
          .attr('cx', d => xScale(d.k)).attr('cy', d => yScale(d.p))
          .attr('fill', color(t))
          .style('cursor', 'pointer')
          .attr('stroke', d => selSet?.has(d.k) ? color(t) : 'none')
          .attr('stroke-width', d => selSet?.has(d.k) ? 2 : 0)
          .attr('stroke-opacity', d => selSet?.has(d.k) ? 0.9 : 0),
        tIsInlier
      )
        .on('mouseover', function (_, d) {
          d3.select(this).attr('r', 4)
          showTip(tooltip, _, `<strong>${t}</strong><br>${tipFor(d)}`)
        })
        .on('mouseout', function () { d3.select(this).attr('r', 3); hideTip(tooltip) })
        .on('click', function (_, d) { selectIdsForBin(d.k, t) })

      if (!st) return
      const clamp = val => useLogX ? Math.max(1, val) : val
      const overlayOn = isOverlayOn(t)
      const isSubset = activeN < baselineN

      // Grey baseline (only for strictly filtered types).
      if (overlayOn && isSubset && stBase) {
        if (ctrl.showIqr && stBase.p25 != null && stBase.p75 > stBase.p25) {
          const lo = clamp(stBase.p25), hi = clamp(stBase.p75)
          if (!useLogX || lo >= 1) {
            g.append('rect')
              .attr('x', xScale(lo)).attr('width', Math.max(0, xScale(hi) - xScale(lo)))
              .attr('y', 0).attr('height', lineH)
              .attr('fill', BASELINE_COLOR).attr('opacity', BASELINE_RECT_OPACITY).style('pointer-events', 'none')
          }
        }
        if (ctrl.showMean && (!useLogX || stBase.mean >= 1)) {
          const x = xScale(clamp(stBase.mean))
          g.append('line').attr('x1', x).attr('x2', x).attr('y1', 0).attr('y2', lineH)
            .attr('stroke', BASELINE_COLOR).attr('stroke-width', 1).attr('stroke-dasharray', '4,3').attr('opacity', BASELINE_LINE_OPACITY)
          attachVLineTooltip(g, x, lineH, `<strong>${t} — Mean (full)</strong><br>${FORMATTERS.number(stBase.mean)}`, tooltip)
        }
        if (ctrl.showMedian && (!useLogX || stBase.median >= 1)) {
          const x = xScale(clamp(stBase.median))
          g.append('line').attr('x1', x).attr('x2', x).attr('y1', 0).attr('y2', lineH)
            .attr('stroke', BASELINE_COLOR).attr('stroke-width', 1).attr('stroke-dasharray', '2,3').attr('opacity', BASELINE_LINE_OPACITY)
          attachVLineTooltip(g, x, lineH, `<strong>${t} — Median (full)</strong><br>${FORMATTERS.number(stBase.median)}`, tooltip)
        }
      }

      if (overlayOn && ctrl.showMean && (!useLogX || st.mean >= 1)) {
        const x = xScale(clamp(st.mean))
        g.append('line').attr('x1', x).attr('x2', x).attr('y1', 0).attr('y2', lineH)
          .attr('stroke', color(t)).attr('stroke-width', 1).attr('stroke-dasharray', '4,3').attr('opacity', 0.55)
        attachVLineTooltip(g, x, lineH, `<strong>${t} — Mean${isSubset ? ' (subset)' : ''}</strong><br>${FORMATTERS.number(st.mean)}`, tooltip)
      }
      if (overlayOn && ctrl.showMedian && (!useLogX || st.median >= 1)) {
        const x = xScale(clamp(st.median))
        g.append('line').attr('x1', x).attr('x2', x).attr('y1', 0).attr('y2', lineH)
          .attr('stroke', color(t)).attr('stroke-width', 1).attr('stroke-dasharray', '2,3').attr('opacity', 0.55)
        attachVLineTooltip(g, x, lineH, `<strong>${t} — Median${isSubset ? ' (subset)' : ''}</strong><br>${FORMATTERS.number(st.median)}`, tooltip)
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

    // Legend circles match dot appearance; only types with active data.
    const legendTypes = perType.filter(p => p.pts.length).map(p => p.t)
    const legendX = innerW - 10
    legendTypes.forEach((t, i) => {
      const y = 12 + i * 16
      g.append('circle').attr('cx', legendX - 5).attr('cy', y).attr('r', 3)
        .attr('fill', color(t)).attr('opacity', ctrl.showOutliers ? 0.45 : 1.0)
      g.append('text').attr('x', legendX - 12).attr('y', y + 4)
        .attr('text-anchor', 'end').attr('font-size', '11px').attr('fill', color(t)).text(t)
    })

    const fitByType = fit.value?.by_type || {}
    perType.forEach(({ t, pts, baselineN }) => {
      if (!pts.length) return
      if (!isFitOn(t)) return
      // Baseline count keeps the curve anchored to the full graph (CSN framework).
      drawFitCurves(g, fitByType[t], xScale, yScale, isCCDF, baselineN, yMode, useLogX, fitVisible.value, color(t))
    })

    // Legend extension: fits + overlays in neutral grey (color is spent on type).
    let extY = 12 + legendTypes.length * 16
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

  // Total branch (PMF / CCDF).
  const activeStats = activeData.value.stats || {}
  const baselineStats = baselineData.value.stats || {}
  const filteredSeq = activeData.value.seq
  const baselineSeq = baselineData.value.seq
  const isSubset = filteredSeq.length < baselineSeq.length
  const points = scaleP(buildFn(filteredSeq), filteredSeq.length)
  const visible = useLogX ? points.filter(d => d.k >= 1) : points
  if (!visible.length) return

  const { xScale, yScale } = buildScales(visible, innerW, lineH, useLogX, useLogY)
  drawGrid(g, xScale, yScale, innerW, lineH)

  const clamp = val => useLogX ? Math.max(1, val) : val

  // Grey baseline only when active is a strict subset; otherwise it'd duplicate the colored layer.
  if (isSubset && baselineStats.mean != null) {
    if (ctrl.showIqr && baselineStats.p25 != null && (!useLogX || baselineStats.p25 >= 1)) {
      const xLo = xScale(clamp(baselineStats.p25)), xHi = xScale(clamp(baselineStats.p75))
      g.append('rect')
        .attr('x', xLo).attr('width', Math.max(0, xHi - xLo))
        .attr('y', 0).attr('height', lineH)
        .attr('fill', BASELINE_COLOR).attr('opacity', BASELINE_RECT_OPACITY).style('pointer-events', 'none')
    }
    if (ctrl.showMean && (!useLogX || baselineStats.mean >= 1)) {
      const x = xScale(baselineStats.mean)
      g.append('line').attr('x1', x).attr('x2', x).attr('y1', 0).attr('y2', lineH)
        .attr('stroke', BASELINE_COLOR).attr('stroke-width', 1).attr('stroke-dasharray', '4,3').attr('opacity', BASELINE_LINE_OPACITY)
      attachVLineTooltip(g, x, lineH, `<strong>Mean (full)</strong><br>${FORMATTERS.number(baselineStats.mean)}`, tooltip)
    }
    if (ctrl.showMedian && (!useLogX || baselineStats.median >= 1)) {
      const x = xScale(baselineStats.median)
      g.append('line').attr('x1', x).attr('x2', x).attr('y1', 0).attr('y2', lineH)
        .attr('stroke', BASELINE_COLOR).attr('stroke-width', 1).attr('stroke-dasharray', '4,3').attr('opacity', BASELINE_LINE_OPACITY)
      attachVLineTooltip(g, x, lineH, `<strong>Median (full)</strong><br>${FORMATTERS.number(baselineStats.median)}`, tooltip)
    }
  }

  if (activeStats.mean != null) {
    if (ctrl.showIqr && activeStats.p25 != null && (!useLogX || activeStats.p25 >= 1)) {
      const xLo = xScale(clamp(activeStats.p25)), xHi = xScale(clamp(activeStats.p75))
      g.append('rect')
        .attr('x', xLo).attr('width', Math.max(0, xHi - xLo))
        .attr('y', 0).attr('height', lineH)
        .attr('fill', COLOR_SCHEME.accent).attr('opacity', 0.1).style('pointer-events', 'none')
    }
    if (ctrl.showMean && (!useLogX || activeStats.mean >= 1)) {
      const x = xScale(activeStats.mean)
      g.append('line').attr('x1', x).attr('x2', x).attr('y1', 0).attr('y2', lineH)
        .attr('stroke', COLOR_SCHEME.accent).attr('stroke-width', 1).attr('stroke-dasharray', '4,3').attr('opacity', 0.55)
      const tip = `<strong>Mean${isSubset ? ' (subset)' : ''}</strong><br>${FORMATTERS.number(activeStats.mean)}${activeStats.std != null ? `<br>Std: ${FORMATTERS.number(activeStats.std)}` : ''}`
      attachVLineTooltip(g, x, lineH, tip, tooltip)
    }
    if (ctrl.showMedian && (!useLogX || activeStats.median >= 1)) {
      const x = xScale(activeStats.median)
      g.append('line').attr('x1', x).attr('x2', x).attr('y1', 0).attr('y2', lineH)
        .attr('stroke', COLOR_SCHEME.success).attr('stroke-width', 1).attr('stroke-dasharray', '4,3').attr('opacity', 0.55)
      attachVLineTooltip(g, x, lineH, `<strong>Median${isSubset ? ' (subset)' : ''}</strong><br>${FORMATTERS.number(activeStats.median)}`, tooltip)
    }
  }

  // Whiskers reflect the subset — outlier-ness is relative to the visible population.
  const wlo = activeStats.wlo ?? -Infinity
  const whi = activeStats.whi ?? Infinity
  const isInlier = d => ctrl.showOutliers && (d.k >= wlo && d.k <= whi)
  const selAll = selectedDegrees.value?.all ?? new Set()
  applyOutlierEncoding(
    g.selectAll('.dot').data(visible).join('circle')
      .attr('class', 'dot')
      .attr('cx', d => xScale(d.k)).attr('cy', d => yScale(d.p))
      .attr('fill', COLOR_SCHEME.accent)
      .style('cursor', 'pointer')
      .attr('stroke', d => selAll.has(d.k) ? COLOR_SCHEME.accent : 'none')
      .attr('stroke-width', d => selAll.has(d.k) ? 2 : 0)
      .attr('stroke-opacity', d => selAll.has(d.k) ? 0.9 : 0),
    isInlier
  )
    .on('mouseover', function (_, d) {
      d3.select(this).attr('r', 4)
      const yLab = yMode === 'count' ? (isCCDF ? 'Count(K ≥ k)' : 'Count') : (isCCDF ? 'P(K ≥ k)' : 'P(k)')
      showTip(tooltip, _, `k = ${d.k}<br>${yLab} = ${fmtY(d.p)}`)
    })
    .on('mouseout', function () { d3.select(this).attr('r', 3); hideTip(tooltip) })
    .on('click', function (_, d) { selectIdsForBin(d.k) })

  // Anchored to the full graph (CSN); divergence vs subset is the analytic signal.
  drawFitCurves(g, fit.value?.all, xScale, yScale, isCCDF, baselineSeq.length, yMode, useLogX, fitVisible.value)

  // All-mode legend.
  const legendItems = [{ kind: 'dot', color: COLOR_SCHEME.accent, label: 'Data' }]
  for (const name of FIT_NAMES) {
    if (fitVisible.value[name]) legendItems.push({ kind: 'line', color: FIT_COLORS[name], dash: FIT_DASHES[name] ?? '5,4', label: FIT_LABELS[name] })
  }
  if (ctrl.showIqr && activeStats.p25 != null) {
    legendItems.push({ kind: 'rect', color: COLOR_SCHEME.accent, label: 'IQR' })
  }
  if (ctrl.showMean && activeStats.mean != null) {
    legendItems.push({ kind: 'vline', color: COLOR_SCHEME.accent, label: 'Mean' })
  }
  if (ctrl.showMedian && activeStats.median != null) {
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
      <div class="flex flex-col gap-3 text-[10px]">

        <div class="grid grid-cols-2 gap-4 items-stretch">
          <div class="flex flex-col gap-1">
            <span class="text-[9px] font-semibold uppercase tracking-wide text-muted">View</span>
            <ControlToggleGroup :model-value="view" :options="VIEW_OPTIONS" @update:model-value="view = $event" />
          </div>
          <div class="flex flex-col gap-1">
            <span class="text-[9px] font-semibold uppercase tracking-wide text-muted">Breakdown</span>
            <ControlToggleGroup :model-value="controls.byType" :options="BY_TYPE_OPTIONS" @update:model-value="updateControl('byType', $event)" />
          </div>
        </div>

        <div class="grid grid-cols-2 gap-4 items-stretch">
          <div class="flex flex-col gap-1">
            <span class="text-[9px] font-semibold uppercase tracking-wide text-muted">Y axis</span>
            <ControlToggleGroup :model-value="controls.yAxis" :options="Y_AXIS_OPTIONS" @update:model-value="updateControl('yAxis', $event)" />
          </div>
          <div class="flex flex-col gap-1">
            <span class="text-[9px] font-semibold uppercase tracking-wide text-muted">Scale</span>
            <ControlToggleGroup :model-value="controls.scale" :options="SCALE_OPTIONS" @update:model-value="updateControl('scale', $event)" />
          </div>
        </div>

        <div class="grid grid-cols-2 gap-4">
          <div class="flex flex-col gap-1">
            <span class="text-[9px] font-semibold uppercase tracking-wide text-muted">Overlay</span>
            <template v-if="controls.byType && availableTypes.length > 1">
              <div class="flex flex-wrap gap-1">
                <button v-for="t in availableTypes" :key="'o-'+t"
                  class="type-chip px-1.5 py-0 text-[10px]"
                  :class="{ 'type-chip--active': isOverlayOn(t) }"
                  :style="isOverlayOn(t) ? { backgroundColor: typeColor(t) + '22', borderColor: typeColor(t), color: typeColor(t) } : { borderColor: typeColor(t), color: typeColor(t) }"
                  @click="toggleOverlayType(t)">{{ t }}</button>
              </div>
            </template>
            <div class="flex flex-col gap-1">
              <ControlBoolean label="Mean" :model-value="controls.showMean" @update:model-value="updateControl('showMean', $event)" />
              <ControlBoolean label="Median" :model-value="controls.showMedian" @update:model-value="updateControl('showMedian', $event)" />
              <ControlBoolean label="IQR" :model-value="controls.showIqr" @update:model-value="updateControl('showIqr', $event)" />
              <ControlBoolean label="Outliers" :model-value="controls.showOutliers" @update:model-value="updateControl('showOutliers', $event)" />
            </div>
          </div>
          <div class="flex flex-col gap-1">
            <span class="text-[9px] font-semibold uppercase tracking-wide text-muted">Fit <span class="normal-case font-normal">(↑ LL)</span></span>
            <template v-if="controls.byType && availableTypes.length > 1">
              <div class="flex flex-wrap gap-1">
                <button v-for="t in availableTypes" :key="'f-'+t"
                  class="type-chip px-1.5 py-0 text-[10px]"
                  :class="{ 'type-chip--active': isFitOn(t) }"
                  :style="isFitOn(t) ? { backgroundColor: typeColor(t) + '22', borderColor: typeColor(t), color: typeColor(t) } : { borderColor: typeColor(t), color: typeColor(t) }"
                  @click="toggleFitType(t)">{{ t }}</button>
              </div>
            </template>
            <div class="flex flex-col gap-1">
              <ControlBoolean
                v-for="s in fitSwitches" :key="s.name"
                :label="s.label"
                :model-value="fitVisible[s.name]"
                @update:model-value="fitVisible[s.name] = $event" />
            </div>
          </div>
        </div>

      </div>
    </Teleport>

    <div v-if="loading" class="text-sm text-secondary p-3 surface-recessed rounded-lg">Loading nodes…</div>
    <div v-if="error" class="text-sm text-red-600 p-3 bg-red-50 rounded-lg border border-red-200">{{ error }}</div>
    <p v-if="noNodesActive" class="text-[10px] italic text-amber-600 px-1">No data under current filters.</p>
    <p v-else-if="edgeFilterActive" class="text-[10px] italic text-muted px-1">Degree shown on full graph; edge filter attenuates marks only.</p>
    <div ref="chartContainer" class="chart-elev w-full" style="aspect-ratio: 4/3; position: relative;"></div>

    <p class="text-[10px] leading-tight text-muted px-1">
      Fits anchored to the full graph (CSN, x<sub>min</sub>=1).
      <span v-if="isSubsetActive">Grey overlays show full-graph baseline; colored reflect the current subset.</span>
    </p>
  </div>
</template>
