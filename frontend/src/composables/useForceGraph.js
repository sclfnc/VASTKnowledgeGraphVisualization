// Persistent d3-force lifecycle. Domain-agnostic.
// Reconciliation: surviving nodes keep x/y; new ones spawn near centroid; edges rebuilt every time.
// graphRef change → reconcile; linkDistance/chargeStrength change → live tweak; resize → recenter+restart.
// Hooks: renderNode(g,d) on enter+update; renderEdge(sel) post-join; getRadius(d) for collide;
// onNodeClick(d) / onEdgeClick(d); onSvgBuild({svg}) once per rebuild for <defs>; renderOverlay/overlayTick for parallel layers.
import { onBeforeUnmount, watch, toValue } from 'vue'
import * as d3 from 'd3'

const DEFAULT_RADIUS = 4

export function useForceGraph({
  containerRef,
  graphRef,
  linkDistance,
  chargeStrength,
  renderNode,
  renderEdge,
  getRadius = () => DEFAULT_RADIUS,
  onNodeClick = null,
  onEdgeClick = null,
  onSvgBuild = null,
  renderOverlay = null,
  overlayTick = null,
}) {
  let simulation = null
  let svgSel = null
  let linksG = null
  let nodesG = null
  let resizeObserver = null
  let currentW = 0
  let currentH = 0
  let simNodes = []
  let simLinks = []

  function tick() {
    if (!linksG || !nodesG) return
    linksG.selectAll('line')
      .attr('x1', d => d.source.x)
      .attr('y1', d => d.source.y)
      .attr('x2', d => d.target.x)
      .attr('y2', d => d.target.y)
    nodesG.selectAll('g.node')
      .attr('transform', d => `translate(${d.x},${d.y})`)
    if (overlayTick) overlayTick({ simLinks, simNodes })
  }

  function rebuild() {
    const el = toValue(containerRef)
    if (!el) return
    // Stop any in-flight simulation before re-creating it: otherwise the old
    // sim keeps ticking in background until GC reclaims it (CPU + memory leak
    // on rapid container toggles).
    if (simulation) { simulation.stop(); simulation = null }
    if (svgSel) { svgSel.remove(); svgSel = null }
    currentW = el.clientWidth || 1
    currentH = el.clientHeight || 1
    svgSel = d3.select(el).append('svg')
      .attr('width', currentW).attr('height', currentH)
      .style('display', 'block')
    if (onSvgBuild) onSvgBuild({ svg: svgSel })
    linksG = svgSel.append('g').attr('stroke-linecap', 'round')
    nodesG = svgSel.append('g')

    simulation = d3.forceSimulation(simNodes)
      .force('link', d3.forceLink(simLinks).id(d => d.id).distance(toValue(linkDistance)))
      .force('charge', d3.forceManyBody().strength(toValue(chargeStrength)))
      .force('centerX', d3.forceX(currentW / 2).strength(0.05))
      .force('centerY', d3.forceY(currentH / 2).strength(0.05))
      .force('collide', d3.forceCollide().radius(d => getRadius(d) + 2))
      .on('tick', tick)

    reconcile()
  }

  function reconcile() {
    if (!simulation) return
    const target = toValue(graphRef)
    if (!target) return

    // Nodes diff.
    const wantedIds = new Set(target.nodes.map(n => n.id))
    simNodes = simNodes.filter(n => wantedIds.has(n.id))
    const survived = new Map(simNodes.map(n => [n.id, n]))
    for (const t of target.nodes) {
      const cur = survived.get(t.id)
      if (cur) {
        // Refresh fields in place; preserves datum identity (and x/y).
        Object.assign(cur, t)
      } else {
        // Spawn near centroid with jitter (Bostock's idiom).
        const sx = simNodes.length ? d3.mean(simNodes, n => n.x) ?? currentW / 2 : currentW / 2
        const sy = simNodes.length ? d3.mean(simNodes, n => n.y) ?? currentH / 2 : currentH / 2
        simNodes.push({
          ...t,
          x: sx + (Math.random() - 0.5) * 30,
          y: sy + (Math.random() - 0.5) * 30,
        })
      }
    }

    // Edges: rebuild from string ids; d3.forceLink resolves to node objects.
    simLinks = target.edges.map(e => ({ ...e, source: e.source, target: e.target }))

    simulation.nodes(simNodes)
    simulation.force(
      'link',
      d3.forceLink(simLinks).id(d => d.id).distance(toValue(linkDistance)),
    )
    simulation.alpha(0.3).restart()
    redraw()
  }

  function redraw() {
    if (!linksG || !nodesG) return

    // Key by (source,target,type) so d3 reuses unchanged DOM nodes.
    const linkSel = linksG.selectAll('line').data(simLinks, d => `${d.source.id ?? d.source}|${d.target.id ?? d.target}|${d.type}`)
    linkSel.exit().remove()
    const linkEnter = linkSel.enter().append('line')
    if (onEdgeClick) {
      linkEnter.style('cursor', 'pointer').on('click', (_e, d) => onEdgeClick(d))
    }
    renderEdge(linkEnter.merge(linkSel))

    // Both enter and update receive renderNode — inner shape can change post-mount.
    const nodeSel = nodesG.selectAll('g.node').data(simNodes, d => d.id)
    nodeSel.exit().remove()
    const nodeEnter = nodeSel.enter().append('g')
      .attr('class', 'node')
      .style('cursor', onNodeClick ? 'pointer' : 'default')
    if (onNodeClick) {
      nodeEnter.on('click', (_e, d) => onNodeClick(d))
    }
    const merged = nodeEnter.merge(nodeSel)
    merged.each(function (d) { renderNode(d3.select(this), d) })

    if (renderOverlay) renderOverlay({ svg: svgSel, simLinks, simNodes })
  }

  function resize() {
    const el = toValue(containerRef)
    if (!el || !svgSel || !simulation) return
    const w = el.clientWidth, h = el.clientHeight
    if (!w || !h || (w === currentW && h === currentH)) return
    currentW = w; currentH = h
    svgSel.attr('width', w).attr('height', h)
    simulation
      .force('centerX', d3.forceX(w / 2).strength(0.05))
      .force('centerY', d3.forceY(h / 2).strength(0.05))
      .alpha(0.4).restart()
  }

  watch(containerRef, (el, oldEl) => {
    if (oldEl && resizeObserver) resizeObserver.unobserve(oldEl)
    if (el) {
      if (!resizeObserver) resizeObserver = new ResizeObserver(resize)
      resizeObserver.observe(el)
      rebuild()
    }
  }, { immediate: true })

  watch(graphRef, () => reconcile(), { deep: false })

  watch(
    [() => toValue(linkDistance), () => toValue(chargeStrength)],
    ([dist, charge]) => {
      if (!simulation) return
      simulation.force('link')?.distance(dist)
      simulation.force('charge')?.strength(charge)
      simulation.alpha(0.3).restart()
    },
  )

  onBeforeUnmount(() => {
    if (simulation) simulation.stop()
    if (resizeObserver) { resizeObserver.disconnect(); resizeObserver = null }
  })

  return { rebuild, reconcile }
}
