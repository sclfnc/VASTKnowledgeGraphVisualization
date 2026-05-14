// Shared D3 utilities for wiki panels.
// Keep small and focused — utilities used in 0 panels do not belong here.

import * as d3 from 'd3'

export const COLOR_SCHEME = {
  nodeType: d3.scaleOrdinal(d3.schemeCategory10),
  edgeType: d3.scaleOrdinal(d3.schemeSet2),
  sequential: d3.scaleLinear().domain([0, 1]).range(['#f7fbff', '#08519c']),
  diverging: d3.scaleDiverging([-1, 0, 1], d3.interpolateRdBu),
  accent: '#0284c7',
  error: '#ef4444',
  success: '#10b981',
  muted: '#64748b',
  grid: '#e1e1e1',
}

export const MARGINS = {
  tight: { top: 16, right: 16, bottom: 16, left: 16 },
  standard: { top: 24, right: 32, bottom: 32, left: 48 },
  spacious: { top: 32, right: 48, bottom: 48, left: 64 },
}

export const FORMATTERS = {
  number: d3.format('.2f'),
  integer: d3.format('d'),
  percent: d3.format('.1%'),
  siPrefix: d3.format('.2s'),
  exponential: d3.format('.2e'),
}

export const TRANSITIONS = {
  fast: 200,
  normal: 500,
  slow: 1000,
}

export function createLinearScale(data, domain, range) {
  return d3.scaleLinear()
    .domain(domain || d3.extent(data))
    .range(range || [0, 100])
}

export function createSvgContainer(element, width, height, margins = MARGINS.standard) {
  const svg = d3.select(element).append('svg').attr('width', width).attr('height', height)
  const g = svg.append('g').attr('transform', `translate(${margins.left},${margins.top})`)
  const innerWidth = width - margins.left - margins.right
  const innerHeight = height - margins.top - margins.bottom
  return { svg, g, innerWidth, innerHeight }
}

// Standard outlier encoding: dim inliers (opacity 0.45), keep outliers full opacity.
// Only applied when the user has opted in (the caller decides via isInlierFn closure).
// Orthogonal to color — works on any mark that supports opacity.
export function applyOutlierEncoding(selection, isInlierFn, r = 3) {
  return selection
    .attr('r', r)
    .attr('opacity', d => isInlierFn(d) ? 0.45 : 1.0)
    .attr('stroke', 'none')
}

// ── Summary stats ─────────────────────────────────────────────────────
// mean/median/std + IQR-based whiskers for outlier detection.
// Returns null on empty input. Single pass after sort.
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

// ── Tooltips ──────────────────────────────────────────────────────────
// One floating div per chart; the caller positions/hides it on hover.
export function makeTooltip(container) {
  return d3.select(container).append('div')
    .style('position', 'absolute').style('pointer-events', 'none')
    .style('background', 'white').style('border', '1px solid #e2e8f0')
    .style('border-radius', '4px').style('padding', '4px 8px')
    .style('font-size', '12px').style('color', '#334155').style('opacity', 0)
}

export function showTip(tooltip, event, html) {
  tooltip.style('opacity', 1)
    .style('left', (event.offsetX + 12) + 'px')
    .style('top', (event.offsetY - 20) + 'px')
    .html(html)
}

export function hideTip(tooltip) { tooltip.style('opacity', 0) }

export function attachVLineTooltip(g, x, h, html, tooltip) {
  g.append('rect')
    .attr('x', x - 6).attr('y', 0).attr('width', 12).attr('height', h)
    .attr('fill', 'transparent').style('cursor', 'pointer')
    .on('mouseover', e => showTip(tooltip, e, html))
    .on('mousemove', e => tooltip.style('left', (e.offsetX + 12) + 'px').style('top', (e.offsetY - 20) + 'px'))
    .on('mouseout', () => hideTip(tooltip))
}

// ── Axes & grid ───────────────────────────────────────────────────────
export function drawGrid(g, xScale, yScale, innerW, innerH) {
  g.append('g').attr('class', 'grid')
    .call(d3.axisLeft(yScale).ticks(5).tickSize(-innerW).tickFormat(''))
    .call(s => s.selectAll('line').attr('stroke', COLOR_SCHEME.grid).attr('stroke-width', 0.5))
    .call(s => s.selectAll('.domain').remove())
  g.append('g').attr('class', 'grid').attr('transform', `translate(0,${innerH})`)
    .call(d3.axisBottom(xScale).ticks(6).tickSize(-innerH).tickFormat(''))
    .call(s => s.selectAll('line').attr('stroke', COLOR_SCHEME.grid).attr('stroke-width', 0.5))
    .call(s => s.selectAll('.domain').remove())
}

// Axes with bottom + left labels. tickFmt is a d3.format-compatible string.
export function drawAxes(g, xScale, yScale, innerW, innerH, opts = {}) {
  const { xLabel = '', yLabel = '', yTickFmt = null, xTickFmt = null, yTicks = 5, xTicks = 6 } = opts
  const yAxis = d3.axisLeft(yScale).ticks(yTicks)
  if (yTickFmt) yAxis.tickFormat(d3.format(yTickFmt))
  g.append('g').call(yAxis)
    .append('text').attr('transform', 'rotate(-90)').attr('x', -innerH / 2).attr('y', -32)
    .attr('fill', COLOR_SCHEME.muted).attr('font-size', '12px').attr('text-anchor', 'middle').text(yLabel)
  const xAxis = d3.axisBottom(xScale).ticks(xTicks)
  if (xTickFmt) xAxis.tickFormat(d3.format(xTickFmt))
  g.append('g').attr('transform', `translate(0,${innerH})`).call(xAxis)
    .append('text').attr('x', innerW / 2).attr('y', 28)
    .attr('fill', COLOR_SCHEME.muted).attr('font-size', '12px').attr('text-anchor', 'middle').text(xLabel)
}

// Line with optional dash. Solid → width 1.8, dashed → 1.5 + rounded caps.
// Accessors x/y default to (d.k, d.p) — the convention used across panels.
export function drawLine(g, pts, xScale, yScale, color, dashArray = null, accessors = null) {
  const ax = accessors?.x ?? (d => d.k)
  const ay = accessors?.y ?? (d => d.p)
  const path = d3.line().x(d => xScale(ax(d))).y(d => yScale(ay(d)))
  const p = g.append('path').datum(pts).attr('fill', 'none').attr('stroke', color).attr('d', path)
  if (dashArray) {
    p.attr('stroke-width', 1.5).attr('stroke-dasharray', dashArray).attr('stroke-linecap', 'round').attr('opacity', 0.85)
  } else {
    p.attr('stroke-width', 1.8)
  }
  return p
}

// ── Histograms ────────────────────────────────────────────────────────
export function createHistogram(data, binCount = 30, accessor = d => d) {
  const clean = data.filter(d => d !== null && d !== undefined)
  const bins = d3.histogram()
    .domain([d3.min(clean, accessor), d3.max(clean, accessor)])
    .thresholds(binCount)(clean.map(accessor))

  return bins.map(bin => ({
    x0: bin.x0,
    x1: bin.x1,
    count: bin.length,
    mid: (bin.x0 + bin.x1) / 2,
  }))
}
