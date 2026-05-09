// Shared D3 utilities for wiki panels.
// Keep small and focused — utilities used in 0 panels do not belong here.

import * as d3 from 'd3'

export const COLOR_SCHEME = {
  nodeType: d3.scaleOrdinal(d3.schemeCategory10),
  edgeType: d3.scaleOrdinal(d3.schemeSet2),
  sequential: d3.scaleLinear().domain([0, 1]).range(['#f7fbff', '#08519c']),
  diverging: d3.scaleDiverging([-1, 0, 1], d3.interpolateRdBu),
  accent: '#0ea5e9',
  error: '#ef4444',
  success: '#10b981',
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
