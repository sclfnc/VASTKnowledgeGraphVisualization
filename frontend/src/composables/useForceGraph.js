// Persistent d3-force lifecycle. Domain-agnostic.
// Reconciliation: surviving nodes keep x/y; new ones spawn near centroid; edges rebuilt every time.
// graphRef change → reconcile; linkDistance/chargeStrength change → live tweak; resize → recenter+restart.
// Hooks: renderNode(g,d) on enter+update; renderEdge(sel) post-join; getRadius(d) for collide;
// onNodeClick(d) / onEdgeClick(d); onSvgBuild({svg}) once per rebuild for <defs>; renderOverlay/overlayTick for parallel layers.
import { onBeforeUnmount, watch, toValue } from 'vue'
import * as d3 from 'd3'
import { seededUnit } from '@/panels/shared.js'

// Squared pixel distance below which a drag is treated as a click (so a node
// click still toggles selection / navigates, but a deliberate drag does not).
const CLICK_SLOP_SQ = 16

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
  // Optional hook to install / refresh panel-specific forces. Called once per
  // rebuild (after the default forces are set) and again on every resize (the
  // panel may anchor things to width/height). Signature:
  //   configureForces({ simulation, width, height })
  // When absent, the default centering forces (centerX/centerY) stand alone.
  // The panel can override centerX/centerY or add named forces; useForceGraph
  // never removes them, so a panel that returns to default should reinstate the
  // centering forces itself.
  configureForces = null,
  // Optional hook to draw panel chrome behind the graph (e.g. Venn circles).
  // Called whenever forces are (re)configured. Signature:
  //   renderBackdrop({ backdrop, width, height })
  // `backdrop` is a d3 selection of a <g> inside the viewport, under links/nodes.
  renderBackdrop = null,
  // Optional getter returning the reactive grid-span flags
  // (e.g. `() => [props.widened, props.expanded]`). Maximize/widen change the
  // card's grid span; the ResizeObserver can miss that transition tick, so we
  // call resize() after the layout settles. Double rAF: first frame applies the
  // span, second reads the settled size. Single source of truth for span-driven
  // resizing — do NOT re-implement the watch in panels.
  spanFlags = null,
}) {
  let simulation = null
  let svgSel = null
  let viewportG = null
  let backdropG = null
  let linksG = null
  let nodesG = null
  let zoomBehavior = null
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
    if (svgSel) { svgSel.remove(); svgSel = null; viewportG = null; zoomBehavior = null }
    currentW = el.clientWidth || 1
    currentH = el.clientHeight || 1
    // Absolute-positioned so the SVG never contributes to the container's
    // in-flow height. The container is aspect-ratio driven (4/3): if the SVG
    // were in flow, its explicit height would gonfiare the container and the
    // two would feed each other, leaving the card stuck tall after a shrink.
    svgSel = d3.select(el).append('svg')
      .attr('width', currentW).attr('height', currentH)
      .style('display', 'block')
      .style('position', 'absolute')
      .style('inset', '0')
    if (onSvgBuild) onSvgBuild({ svg: svgSel })

    // Pan/zoom viewport. All marks live inside this <g>; the zoom transform is
    // applied to it, so the force simulation keeps running in world coordinates
    // unaffected. <defs>/markers from onSvgBuild stay on the SVG (outside the
    // viewport) so they don't scale with the content.
    viewportG = svgSel.append('g').attr('class', 'viewport')
    // Backdrop layer for panel chrome drawn behind the graph (e.g. Venn circles).
    // Inside the viewport, so it pans/zooms with the content; first child, so it
    // sits under links and nodes.
    backdropG = viewportG.append('g').attr('class', 'backdrop')
    linksG = viewportG.append('g').attr('stroke-linecap', 'round')
    nodesG = viewportG.append('g')

    zoomBehavior = d3.zoom()
      .scaleExtent([0.2, 8])
      // Pan starts only on the empty background (not on a node — those get the
      // node drag). Wheel always zooms. dblclick zoom disabled (reserved).
      .filter(event => (event.type === 'wheel') || !event.target.closest('g.node'))
      .on('zoom', event => { viewportG.attr('transform', event.transform) })
    svgSel.call(zoomBehavior).on('dblclick.zoom', null)
    svgSel.style('cursor', 'grab')
    svgSel.on('mousedown.cursor', () => svgSel.style('cursor', 'grabbing'))
      .on('mouseup.cursor', () => svgSel.style('cursor', 'grab'))

    simulation = d3.forceSimulation(simNodes)
      .force('link', d3.forceLink(simLinks).id(d => d.id).distance(toValue(linkDistance)))
      .force('charge', d3.forceManyBody().strength(toValue(chargeStrength)))
      .force('centerX', d3.forceX(currentW / 2).strength(0.05))
      .force('centerY', d3.forceY(currentH / 2).strength(0.05))
      .force('collide', d3.forceCollide().radius(d => getRadius(d) + 2))
      .on('tick', tick)

    runPanelHooks(currentW, currentH)

    reconcile()
  }

  // Run the panel's force + backdrop hooks together (both depend on size/state).
  function runPanelHooks(w, h) {
    if (configureForces) configureForces({ simulation, width: w, height: h })
    if (renderBackdrop && backdropG) renderBackdrop({ backdrop: backdropG, width: w, height: h })
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
        // Spawn near centroid with deterministic jitter (seededUnit instead of
        // Math.random so a reconcile doesn't reshuffle surviving layout).
        const sx = simNodes.length ? d3.mean(simNodes, n => n.x) ?? currentW / 2 : currentW / 2
        const sy = simNodes.length ? d3.mean(simNodes, n => n.y) ?? currentH / 2 : currentH / 2
        simNodes.push({
          ...t,
          x: sx + (seededUnit(`${t.id}|x`) - 0.5) * 30,
          y: sy + (seededUnit(`${t.id}|y`) - 0.5) * 30,
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
    // Re-run the panel hooks now that nodes exist: per-node force targets /
    // pinned vertices can only be assigned once the diffed nodes are in place.
    runPanelHooks(currentW, currentH)
    simulation.alpha(0.3).restart()
    redraw()
  }

  // Node drag: pin the node under the cursor while dragging and leave it pinned
  // on release, so the user can untangle a crowded layout and it stays put.
  // A drag past CLICK_SLOP_SQ flags the datum so the trailing click is ignored.
  function makeDrag() {
    return d3.drag()
      // Resolve pointer coords against the viewport <g>, so event.x/y are in
      // world coordinates even when the scene is panned/zoomed.
      .container(() => viewportG.node())
      .on('start', (event, d) => {
        if (!event.active && simulation) simulation.alphaTarget(0.3).restart()
        d.fx = d.x; d.fy = d.y
        d._dragStart = [event.x, event.y]
        d._dragged = false
      })
      .on('drag', (event, d) => {
        d.fx = event.x; d.fy = event.y
        if (!d._dragged && d._dragStart) {
          const dx = event.x - d._dragStart[0]
          const dy = event.y - d._dragStart[1]
          if (dx * dx + dy * dy > CLICK_SLOP_SQ) d._dragged = true
        }
      })
      .on('end', (event, d) => {
        if (!event.active && simulation) simulation.alphaTarget(0)
        // Leave fx/fy set: the node stays pinned where the user dropped it.
        d._dragStart = null
      })
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
      .style('cursor', onNodeClick ? 'pointer' : 'grab')
    if (onNodeClick) {
      nodeEnter.on('click', (_e, d) => {
        // Suppress the click that closes a drag (drag sets _dragged on the datum).
        if (d._dragged) { d._dragged = false; return }
        onNodeClick(d)
      })
    }
    nodeEnter.call(makeDrag())
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
    // Let the panel re-anchor width/height-dependent forces (e.g. polygon
    // vertices) and redraw chrome before restarting — runs after the default
    // centering above so a panel that overrides centerX/centerY wins.
    runPanelHooks(w, h)
    simulation.alpha(0.4).restart()
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

  if (spanFlags) {
    watch(spanFlags, () => {
      requestAnimationFrame(() => requestAnimationFrame(resize))
    })
  }

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

  // Re-run the panel force hook with the current size and reheat. Call when the
  // panel's force configuration depends on reactive state that changed without
  // a graph rebuild or resize (e.g. an ego count / view-mode toggle).
  function applyForces() {
    if (!simulation) return
    runPanelHooks(currentW, currentH)
    simulation.alpha(0.5).restart()
  }

  return { rebuild, reconcile, resize, applyForces }
}
