// Shared D3 utilities for panels. Keep small — drop utilities with zero consumers.

import * as d3 from 'd3'

export const COLOR_SCHEME = {
  accent: '#0284c7',
  success: '#10b981',
  grid: '#e1e1e1', // internal: used by drawGrid below
}

// Default chart margins; panels with long category labels override left/right.
export const MARGINS_DEFAULT = { top: 8, right: 12, bottom: 38, left: 44 }

// Resolve container + inner box from margins; minInner guards collapsing cards.
export function svgFrame(container, margins, opts = {}) {
  const { fallbackW = 400, fallbackH = null, aspect = 3 / 4, minInner = 40 } = opts
  const totalW = container.clientWidth || fallbackW
  const totalH = container.clientHeight || fallbackH || Math.round(totalW * aspect)
  const innerW = Math.max(minInner, totalW - margins.left - margins.right)
  const innerH = Math.max(minInner, totalH - margins.top - margins.bottom)
  return { totalW, totalH, innerW, innerH }
}

// Opacity for marks outside the active mask. Single source of truth.
export const ATTENUATED_OPACITY = 0.12

// EgoComparison pie semantics break above 4 hues.
export const LAYER_PALETTE = ['#0ea5e9', '#f59e0b', '#10b981', '#a855f7']

// Degree-fit families → fixed colors.
export const FIT_COLORS = {
  powerlaw: '#ef4444',
  exponential: '#f97316',
  poisson: '#8b5cf6',
  lognormal: '#06b6d4',
}

export const FORMATTERS = {
  number: d3.format('.2f'),
  number3: d3.format('.3f'),
  integer: d3.format('d'),
  percent: d3.format('.1%'),
  percent0: d3.format('.0%'),
  fixed1: d3.format('.1f'),
  siPrefix: d3.format('.2s'),
  siCompact: d3.format('~s'),
  exponential: d3.format('.2e'),
}

// Mean/median/std + IQR whiskers; null on empty input.
export function summaryStats(seq) {
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
  const p25 = pct(0.25), p75 = pct(0.75), iqr = p75 - p25
  return {
    mean, median, std, p25, p75, iqr,
    wlo: Math.max(sorted[0], p25 - 1.5 * iqr),
    whi: Math.min(sorted[n - 1], p75 + 1.5 * iqr),
  }
}

// One floating div per chart; caller positions/hides it on hover.
export function makeTooltip(container) {
  return d3.select(container).append('div')
    .style('position', 'absolute').style('pointer-events', 'none')
    .style('background', 'white').style('border', '1px solid #e2e8f0')
    .style('border-radius', '4px').style('padding', '4px 8px')
    .style('font-size', '12px').style('color', '#334155').style('opacity', 0)
}

// `html === null` updates position only — callers pass null on mousemove to
// reposition without re-setting (and blanking) the tooltip text.
//
// Position is computed with d3.pointer against the tooltip's own container, not
// event.offsetX/offsetY. offset* is relative to the event *target*, which breaks
// when the target sits inside a transformed <g> (pan/zoom viewport) or is a
// clipped shape — the tooltip would jump far off. Pointer-vs-container is stable
// regardless of the target, and matches offset* when the SVG fills the container.
export function showTip(tooltip, event, html) {
  const container = tooltip.node()?.parentNode
  const [px, py] = container ? d3.pointer(event, container) : [event.offsetX, event.offsetY]
  tooltip.style('opacity', 1)
    .style('left', (px + 12) + 'px')
    .style('top', (py - 20) + 'px')
  if (html != null) tooltip.html(html)
}

export function hideTip(tooltip) { tooltip.style('opacity', 0) }

// Standard mouseover/mousemove/mouseout triple; mousemove updates position only.
export function attachTooltip(selection, htmlFn, tooltip) {
  return selection
    .on('mouseover', (event, d) => showTip(tooltip, event, htmlFn(d, event)))
    .on('mousemove', (event) => showTip(tooltip, event, null))
    .on('mouseout', () => hideTip(tooltip))
}

// Inline legend in the top-right corner of an SVG. Vertical stack of
// (circle, label) pairs. `typeColor(type)` returns the dot color.
export function drawTypeLegend(svg, totalW, types, typeColor) {
  const lx = totalW - 8
  types.forEach((t, i) => {
    const ly = 12 + i * 14
    svg.append('circle').attr('cx', lx - 6).attr('cy', ly).attr('r', 3.5)
      .attr('fill', typeColor(t))
    svg.append('text').attr('x', lx - 12).attr('y', ly + 4)
      .attr('text-anchor', 'end').attr('font-size', '10px')
      .attr('fill', '#64748b').text(t)
  })
}

// Intersect `all` with a filters-store list; empty/null filter means "no filter".
export function visibleSubset(filterList, all) {
  if (!filterList || filterList.length === 0) return all
  const visible = new Set(filterList)
  return all.filter(t => visible.has(t))
}

// Membership predicate from a filters-store list; empty/null accepts everything.
export function visibleSetPred(filterList) {
  if (!filterList || filterList.length === 0) return () => true
  const visible = new Set(filterList)
  return t => visible.has(t)
}

// Collect node ids whose type matches, capped at `cap`.
export function idsOfTypes(nodes, types, cap = Infinity) {
  if (!Array.isArray(nodes)) return []
  const want = types instanceof Set ? types
    : new Set(Array.isArray(types) ? types : [types])
  const out = []
  for (const n of nodes) {
    if (want.has(n.type)) {
      out.push(n.id)
      if (out.length >= cap) break
    }
  }
  return out
}

// Pearson correlation; 0 on empty or zero-variance input.
export function pearson(xs, ys) {
  const n = xs.length
  if (!n) return 0
  const mx = xs.reduce((a, b) => a + b, 0) / n
  const my = ys.reduce((a, b) => a + b, 0) / n
  let num = 0, dx = 0, dy = 0
  for (let i = 0; i < n; i++) {
    num += (xs[i] - mx) * (ys[i] - my)
    dx += (xs[i] - mx) ** 2
    dy += (ys[i] - my) ** 2
  }
  const denom = Math.sqrt(dx * dy)
  return denom ? num / denom : 0
}

// Pearson on ranks; ties handled via average rank.
export function spearman(xs, ys) {
  const rank = arr => {
    const idx = arr.map((v, i) => [v, i]).sort((a, b) => a[0] - b[0])
    const r = Array.from({ length: arr.length })
    idx.forEach(([, i], rk) => { r[i] = rk + 1 })
    return r
  }
  return pearson(rank(xs), rank(ys))
}

export function attachVLineTooltip(g, x, h, html, tooltip) {
  g.append('rect')
    .attr('x', x - 6).attr('y', 0).attr('width', 12).attr('height', h)
    .attr('fill', 'transparent').style('cursor', 'pointer')
    .on('mouseover', e => showTip(tooltip, e, html))
    .on('mousemove', e => tooltip.style('left', (e.offsetX + 12) + 'px').style('top', (e.offsetY - 20) + 'px'))
    .on('mouseout', () => hideTip(tooltip))
}

export function drawGrid(g, xScale, yScale, innerW, innerH) {
  // Align gridlines to the same tick values drawAxes uses: powers of 10 on a log
  // scale (d3's default emits 2..9 per decade, which desyncs grid from labels),
  // d3 defaults on a linear scale.
  const yAxis = d3.axisLeft(yScale).tickSize(-innerW).tickFormat('')
  if (isLogScale(yScale)) yAxis.tickValues(logMajorTicks(yScale)); else yAxis.ticks(5)
  g.append('g').attr('class', 'grid')
    .call(yAxis)
    .call(s => s.selectAll('line').attr('stroke', COLOR_SCHEME.grid).attr('stroke-width', 0.5))
    .call(s => s.selectAll('.domain').remove())
  const xAxis = d3.axisBottom(xScale).tickSize(-innerH).tickFormat('')
  if (isLogScale(xScale)) xAxis.tickValues(logMajorTicks(xScale)); else xAxis.ticks(6)
  g.append('g').attr('class', 'grid').attr('transform', `translate(0,${innerH})`)
    .call(xAxis)
    .call(s => s.selectAll('line').attr('stroke', COLOR_SCHEME.grid).attr('stroke-width', 0.5))
    .call(s => s.selectAll('.domain').remove())
}

// Log scales: prefer powers of 10 (d3's default clutters with 2..9 per decade).
// But on a short span the decade boundaries alone can yield ≤2 ticks, making a
// genuine log axis read as linear (one lonely label). When that happens, fall
// back to including the 2/3/5×10ⁿ minor ticks within the domain so the axis is
// visibly logarithmic. Threshold: <3 major powers in range.
function isLogScale(s) { return typeof s?.base === 'function' }
function logMajorTicks(scale) {
  const [a, b] = scale.domain()
  const lo = Math.min(a, b), hi = Math.max(a, b)
  const start = Math.ceil(Math.log10(lo))
  const end = Math.floor(Math.log10(hi))
  const majors = []
  for (let i = start; i <= end; i++) majors.push(Math.pow(10, i))
  if (majors.length >= 3) return majors
  // Short span: add 2/3/5 minor ticks across the decades the domain touches.
  const out = []
  const decStart = Math.floor(Math.log10(lo))
  const decEnd = Math.ceil(Math.log10(hi))
  for (let i = decStart; i <= decEnd; i++) {
    for (const mul of [1, 2, 3, 5]) {
      const v = mul * Math.pow(10, i)
      if (v >= lo && v <= hi) out.push(v)
    }
  }
  return out.length ? out : majors
}
export function drawAxes(g, xScale, yScale, innerW, innerH, opts = {}) {
  const { xLabel = '', yLabel = '', yTickFmt = null, xTickFmt = null, yTicks = 5, xTicks = 6 } = opts
  const axisLabelColor = '#64748b' // slate-500 — neutral for axis labels
  const yAxis = d3.axisLeft(yScale)
  if (isLogScale(yScale)) yAxis.tickValues(logMajorTicks(yScale)).tickFormat(d3.format('.0e'))
  else { yAxis.ticks(yTicks); if (yTickFmt) yAxis.tickFormat(d3.format(yTickFmt)) }
  g.append('g').call(yAxis)
    .append('text').attr('transform', 'rotate(-90)').attr('x', -innerH / 2).attr('y', -32)
    .attr('fill', axisLabelColor).attr('font-size', '12px').attr('text-anchor', 'middle').text(yLabel)
  const xAxis = d3.axisBottom(xScale)
  if (isLogScale(xScale)) xAxis.tickValues(logMajorTicks(xScale)).tickFormat(d3.format('~g'))
  else { xAxis.ticks(xTicks); if (xTickFmt) xAxis.tickFormat(d3.format(xTickFmt)) }
  g.append('g').attr('transform', `translate(0,${innerH})`).call(xAxis)
    .append('text').attr('x', innerW / 2).attr('y', 28)
    .attr('fill', axisLabelColor).attr('font-size', '12px').attr('text-anchor', 'middle').text(xLabel)
}

// Solid → width 1.8; dashed → 1.5 + rounded caps. Default accessors (d.k, d.p).
// Default curve is monotone-X smoothing so sparsely sampled fit curves (e.g.
// degree fits on small k_max) don't render as a polyline — set
// `accessors.curve` to override (e.g. `d3.curveLinear` for a reference line).
export function drawLine(g, pts, xScale, yScale, color, dashArray = null, accessors = null) {
  const ax = accessors?.x ?? (d => d.k)
  const ay = accessors?.y ?? (d => d.p)
  const curve = accessors?.curve ?? d3.curveMonotoneX
  const path = d3.line().x(d => xScale(ax(d))).y(d => yScale(ay(d))).curve(curve)
  const p = g.append('path').datum(pts).attr('fill', 'none').attr('stroke', color).attr('d', path)
  if (dashArray) {
    p.attr('stroke-width', 1.2).attr('stroke-dasharray', dashArray).attr('stroke-linecap', 'round').attr('opacity', 0.85)
  } else {
    p.attr('stroke-width', 1.2)
  }
  return p
}

// Per-type attribute summary formatters; pure text, no DOM.

function fmtNumber(n) {
  if (typeof n !== 'number' || Number.isNaN(n)) return String(n)
  if (n !== 0 && Math.abs(n) < 0.01) return n.toExponential(1)
  if (Number.isInteger(n)) return n.toLocaleString()
  return n.toFixed(2)
}

export function formatAttrSummary(attr) {
  const s = attr?.summary
  if (!s) return ''
  if (attr.kind === 'numeric') {
    return `${fmtNumber(s.min)} – ${fmtNumber(s.max)}`
  }
  if (attr.kind === 'boolean') {
    const total = (s.true || 0) + (s.false || 0)
    if (!total) return ''
    return `${Math.round((s.true / total) * 100)}% true`
  }
  if (attr.kind === 'categorical') {
    const parts = (s.top || []).map(t => `${t.value} (${t.count.toLocaleString()})`)
    const remain = (s.distinct || 0) - (s.top?.length || 0)
    if (remain > 0) parts.push(`+${remain} more`)
    return parts.join(', ')
  }
  if (attr.kind === 'temporal') {
    return `${s.min} – ${s.max}`
  }
  return ''
}

export function formatCoverage(coverage) {
  if (coverage == null) return ''
  const pct = coverage * 100
  if (pct >= 99.95) return '100%'
  if (pct < 0.05) return '<0.1%'
  return `${pct.toFixed(pct < 10 ? 1 : 0)}%`
}

// Set of effective types that have at least one element in `mask`. Shared by
// type-aggregate panels (TypeMixingMatrix, EdgeFlow) to outline the marks whose
// type contains a selected node — the cap-safe "this aggregate holds something
// you selected" signal. `typeAt(i)` resolves the effective type of SoA index i.
export function selectedTypesIn(count, mask, typeAt) {
  const out = new Set()
  if (!mask) return out
  for (let i = 0; i < count; i++) if (mask.get(i)) out.add(typeAt(i))
  return out
}

// Effective-type-aware variant of idsOfTypes over a node SoA. `typeAt(i)`
// resolves the effective type of index i (so it's correct under auto-promotion,
// unlike idsOfTypes which reads raw n.type). Collects ALL matching ids — pass
// the result to selection.replaceCapped to apply the cap and track overflow.
export function idsOfTypesSoA(soa, types, typeAt) {
  if (!soa) return []
  const want = types instanceof Set ? types
    : new Set(Array.isArray(types) ? types : [types])
  const out = []
  for (let i = 0; i < soa.N; i++) {
    if (want.has(typeAt(i))) out.push(soa.ids[i])
  }
  return out
}

// Deterministic [0, 1) from a string key (FNV-1a hash). Use instead of
// Math.random() for jitter/layout that must stay stable across re-renders —
// the same id always lands in the same spot, so a repaint doesn't reshuffle.
export function seededUnit(key) {
  let h = 0x811c9dc5
  const s = String(key)
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i)
    h = Math.imul(h, 0x01000193)
  }
  return ((h >>> 0) % 100000) / 100000
}
