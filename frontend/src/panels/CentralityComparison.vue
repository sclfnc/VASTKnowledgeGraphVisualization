<script setup>
// 4×4 scatter matrix on the four centralities; reads from the global poller.
// Three exclusive branches: error (names failed measures) → loading → ready.
import { ref, computed, toRef, watch, nextTick, onMounted } from 'vue'
import * as d3 from 'd3'
import { useAllCentralities } from '@/composables/useAllCentralities.js'
import { useNodeTypeColors } from '@/composables/useNodeTypeColors.js'
import { useEffectiveType } from '@/composables/useEffectiveType.js'
import { usePanelContextFromProps } from '@/composables/usePanelContext.js'
import { useSelectionStore } from '@/stores/selection.js'
import { usePanel } from './usePanel.js'
import { useD3Chart } from './useD3Chart.js'
import { FORMATTERS, MARGINS_DEFAULT, makeTooltip, showTip, hideTip, drawAxes, drawGrid, pearson, spearman, svgFrame, ATTENUATED_OPACITY, theoryLinkClass, SLATE, COLOR_SCHEME } from './shared.js'
import ControlSection from './controls/ControlSection.vue'
import ControlSwitch from './controls/ControlSwitch.vue'

const props = defineProps({
  panelSpec: { type: Object, required: true },
  schema: { type: Object, default: null },
  graphId: { type: String, default: null },
  widened: { type: Boolean, default: false },
  expanded: { type: Boolean, default: false },
  controlsTarget: { type: String, default: null },
  theoryTarget: { type: String, default: null },
})

const emit = defineEmits(['request-widen', 'request-shrink'])

// Mounted inside PanelFocus? Then the cell drill replaces the matrix (no grid
// to widen), with a "return to global view" button — same idiom as
// ConnectedComponents' in-focus drill.
const inFocus = computed(() => props.theoryTarget != null)

const all = useAllCentralities()
const { color: typeColor } = useNodeTypeColors(toRef(props, 'schema'))
const { nodeType: effNodeType } = useEffectiveType(toRef(props, 'graphId'), toRef(props, 'schema'))
const { activeNodeMask, isActive, isSelected, selectedMask, edgeFilterActive, noNodesActive } = usePanelContextFromProps(props)
const selection = useSelectionStore()
const { controls, updateControl } = usePanel(props, props.panelSpec?.id)
const chartContainer = ref(null)
const detailContainer = ref(null)

// Drill-to-cell: a [rowKey, colKey] pair opens the full-size scatter of that
// measure pair side-by-side with the shrunk matrix (same pattern as
// ConnectedComponents). Toggle off by re-clicking the same cell.
const detailPair = ref(null)

const MEASURE_LABELS = {
  pagerank: 'PageRank',
  eigenvector: 'Eigenvector',
  betweenness: 'Betweenness',
  closeness: 'Closeness',
}
const MEASURE_KEYS = ['pagerank', 'eigenvector', 'betweenness', 'closeness']

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

// Overview uses Spearman only (rank concordance — the right question for
// heavy-tailed centralities; Pearson on raw values is dominated by a handful
// of hubs). The cell detail adds Pearson(log-log) for the power-law slope.
// Symmetric: compute each unordered pair once, mirror it.
const corrs = computed(() => {
  const m = matrix.value
  if (!m) return null
  const out = {}
  for (let i = 0; i < MEASURE_KEYS.length; i++) {
    out[`${MEASURE_KEYS[i]}|${MEASURE_KEYS[i]}`] = 1
    for (let j = i + 1; j < MEASURE_KEYS.length; j++) {
      const ki = MEASURE_KEYS[i], kj = MEASURE_KEYS[j]
      const r = spearman(m.map(r => r[ki]), m.map(r => r[kj]))
      out[`${ki}|${kj}`] = r
      out[`${kj}|${ki}`] = r
    }
  }
  return out
})

// Detail of the clicked pair: full scatter + Spearman & Pearson(log-log).
const detailData = computed(() => {
  const m = matrix.value
  const pair = detailPair.value
  if (!m || !pair) return null
  const [kRow, kCol] = pair
  const rho = spearman(m.map(r => r[kRow]), m.map(r => r[kCol]))
  // Pearson on log values (positive only) — the linearised power-law slope.
  const logPts = m.filter(r => r[kRow] > 0 && r[kCol] > 0)
  const pr = logPts.length >= 3
    ? pearson(logPts.map(r => Math.log(r[kRow])), logPts.map(r => Math.log(r[kCol])))
    : null
  return { kRow, kCol, rho, pr, n: m.length }
})

// Widen mechanism: emit on detailPair change (ConnectedComponents pattern).
// In focus there's no grid to widen — the drill replaces the matrix instead.
watch(detailPair, (val) => {
  if (inFocus.value) return
  if (val != null && !props.widened) emit('request-widen')
  if (val == null && props.widened) emit('request-shrink')
})
// Anti-stale: if GuideView strips `widened` from under us (Maximize, or another
// panel's shrink), clear the local detail so it can't reappear as a ghost.
watch(() => props.widened, (w) => { if (!inFocus.value && !w) detailPair.value = null })

function renderAll() { renderChart(); renderDetail() }

watch([matrix, corrs, controls, () => props.widened, detailPair, activeNodeMask, selectedMask], () => nextTick(renderAll), { deep: true })

useD3Chart([chartContainer, detailContainer], renderAll, () => [props.widened, props.expanded])

// In PanelFocus the chart box is flex-sized: at first mount its height isn't
// settled yet, so the square matrix (min(W,H)) computes cell<20 and bails. The
// ResizeObserver may not fire if the size delta is small. Force a re-render
// after layout settles (double rAF: first frame lays out, second reads it).
onMounted(() => {
  if (inFocus.value) requestAnimationFrame(() => requestAnimationFrame(renderAll))
})

function clickPair(kRow, kCol) {
  if (kRow === kCol) return  // diagonal carries no scatter
  const cur = detailPair.value
  if (cur && cur[0] === kRow && cur[1] === kCol) { detailPair.value = null; return }
  detailPair.value = [kRow, kCol]
}

// Open a pair from a theory link (canonical row>col order: [row, col]).
function openPair(a, b) {
  const i = MEASURE_KEYS.indexOf(a), j = MEASURE_KEYS.indexOf(b)
  detailPair.value = i > j ? [a, b] : [b, a]
}
// Order-agnostic "is this pair currently open" for theory-link highlight.
function isPairOpen(a, b) {
  const p = detailPair.value
  if (!p) return false
  return (p[0] === a && p[1] === b) || (p[0] === b && p[1] === a)
}

// Strongest / weakest off-diagonal Spearman pair, for the live narration.
const theoryStats = computed(() => {
  const c = corrs.value
  if (!c) return null
  let hi = null, lo = null
  for (let i = 0; i < MEASURE_KEYS.length; i++) {
    for (let j = i + 1; j < MEASURE_KEYS.length; j++) {
      const r = c[`${MEASURE_KEYS[i]}|${MEASURE_KEYS[j]}`]
      const rec = { a: MEASURE_KEYS[i], b: MEASURE_KEYS[j], r }
      if (!hi || Math.abs(r) > Math.abs(hi.r)) hi = rec
      if (!lo || Math.abs(r) < Math.abs(lo.r)) lo = rec
    }
  }
  return { hi, lo }
})

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
  // Square inscribed in the box. The .matrix-focus class (focus) and the inline
  // aspect-ratio 1/1 (grid) both keep the box square, so min(W,H) never overflows.
  const side = Math.min(totalW, totalH)
  const inner = Math.max(0, side - PAD_OUT * 2)
  const cell = Math.max(0, (inner - PAD_IN * 3) / 4)
  if (cell < 20) return  // matrix too cramped — card collapsed

  const svg = d3.select(chartContainer.value).append('svg').attr('width', side).attr('height', side)
  const root = svg.append('g').attr('transform', `translate(${PAD_OUT},${PAD_OUT})`)

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
        .attr('fill', '#fff').attr('stroke', SLATE[200]).attr('stroke-width', 1).attr('rx', 4)

      if (row === col) {
        // Diagonal: just the measure name (the correlations live in the cells).
        cellG.append('text')
          .attr('x', cell / 2).attr('y', cell / 2 + 4)
          .attr('text-anchor', 'middle').attr('font-size', '12px')
          .attr('font-weight', '600').attr('fill', SLATE[900])
          .text(MEASURE_LABELS[kRow])
      } else if (row > col) {
        const isDetail = detailPair.value && detailPair.value[0] === kRow && detailPair.value[1] === kCol
        const xs = scales[kCol].copy().range([6, cell - 6])
        const ys = scales[kRow].copy().range([cell - 6, 6])
        // The whole cell is a drill affordance — overlay a transparent hit rect
        // below the marks so clicking empty space still opens the pair.
        cellG.append('rect').attr('width', cell).attr('height', cell)
          .attr('fill', 'transparent').style('cursor', 'pointer')
          .on('click', () => clickPair(kRow, kCol))
        if (isDetail) {
          cellG.select('rect').attr('stroke', SLATE[900]).attr('stroke-width', 1.5).attr('fill', 'none').lower()
        }
        const pts = m
          .filter(r => (!controls.value.logAxes || (r[kCol] > 0 && r[kRow] > 0)))
        cellG.selectAll('circle.pt').data(pts).join('circle').attr('class', 'pt')
          .attr('cx', d => xs(d[kCol]))
          .attr('cy', d => ys(d[kRow]))
          .attr('r', d => isSelected(d.id) ? 2.6 : 1.6)
          .attr('fill', d => typeColor(effNodeType(d)))
          .attr('stroke', d => isSelected(d.id) ? SLATE[900] : 'none')
          .attr('stroke-width', d => isSelected(d.id) ? 0.8 : 0)
          .attr('opacity', d => isActive(d.id) ? 0.55 : ATTENUATED_OPACITY)
          .style('pointer-events', 'none')  // clicks fall through to the cell hit-rect (drill)
      } else {
        // Upper triangle: correlation heat-cell — a numeric door to the same
        // pair drill as the mirrored scatter below the diagonal.
        const r = corrs.value[`${kRow}|${kCol}`] ?? 0
        const abs = Math.abs(r)
        const isDetail = detailPair.value && detailPair.value[0] === kCol && detailPair.value[1] === kRow
        cellG.append('rect').attr('width', cell).attr('height', cell)
          .attr('fill', r >= 0 ? COLOR_SCHEME.accentBright : COLOR_SCHEME.danger)
          .attr('opacity', Math.min(0.4, abs * 0.4))
          .attr('rx', 4)
          .style('cursor', 'pointer')
          .on('click', () => clickPair(kCol, kRow))  // mirror → same [row,col] as the scatter
        if (isDetail) {
          cellG.append('rect').attr('width', cell).attr('height', cell)
            .attr('fill', 'none').attr('stroke', SLATE[900]).attr('stroke-width', 1.5).attr('rx', 4)
            .style('pointer-events', 'none')
        }
        cellG.append('text')
          .attr('x', cell / 2).attr('y', cell / 2 + 4)
          .attr('text-anchor', 'middle')
          .attr('font-size', Math.max(11, cell * 0.18))
          .attr('font-weight', '600').attr('fill', SLATE[900])
          .style('pointer-events', 'none')
          .text(r.toFixed(2))
      }
    }
  }

  svg.append('text')
    .attr('x', PAD_OUT).attr('y', side - 6)
    .attr('font-size', '10px').attr('fill', SLATE[400])
    .text('Closeness: undirected · Spearman ρ · click a cell to drill')
}

// Full-size scatter of the clicked pair: labelled axes, optional log, clickable
// marks → selection, caption with Spearman + Pearson(log-log) + n.
function renderDetail() {
  const el = detailContainer.value
  if (!el) return
  d3.select(el).selectAll('*').remove()
  if (!(props.widened || inFocus.value) || branches.value !== 'ready') return
  const dd = detailData.value
  const m = matrix.value
  if (!dd || !m || !m.length) return
  const { kRow, kCol } = dd

  const margins = { ...MARGINS_DEFAULT, left: 56, bottom: 44 }
  const { totalW, totalH, innerW, innerH } = svgFrame(el, margins, { fallbackW: 360 })
  if (innerW < 40 || innerH < 40) return

  const svg = d3.select(el).append('svg').attr('width', totalW).attr('height', totalH)
  const g = svg.append('g').attr('transform', `translate(${margins.left},${margins.top})`)
  const tooltip = makeTooltip(el)

  const buildScale = (k, range) => {
    const hi = d3.max(m, r => r[k]) || 1
    if (controls.value.logAxes) {
      const lo = d3.min(m.map(r => r[k]).filter(v => v > 0)) || 1e-12
      return d3.scaleLog().domain([Math.max(lo, 1e-12), hi]).range(range).clamp(true)
    }
    return d3.scaleLinear().domain([0, hi]).range(range)
  }
  const xs = buildScale(kCol, [0, innerW])
  const ys = buildScale(kRow, [innerH, 0])

  drawGrid(g, xs, ys, innerW, innerH)
  drawAxes(g, xs, ys, innerW, innerH, { xLabel: MEASURE_LABELS[kCol], yLabel: MEASURE_LABELS[kRow] })

  const pts = m.filter(r => !controls.value.logAxes || (r[kCol] > 0 && r[kRow] > 0))

  // 2D rubber-band brush → selection.replace, same gesture as CentralityPanel's
  // Generic scatter. Inserted below the dots so a single click still reaches a
  // hit circle (toggle); a drag in empty space rubber-bands a box.
  installScatterBrush(g, innerW, innerH, pts, xs, ys, kCol, kRow)

  g.selectAll('circle.pt').data(pts).join('circle').attr('class', 'pt')
    .attr('cx', d => xs(d[kCol]))
    .attr('cy', d => ys(d[kRow]))
    .attr('r', d => isSelected(d.id) ? 4 : 2.6)
    .attr('fill', d => typeColor(effNodeType(d)))
    .attr('stroke', d => isSelected(d.id) ? SLATE[900] : 'none')
    .attr('stroke-width', d => isSelected(d.id) ? 1 : 0)
    .attr('opacity', d => isActive(d.id) ? 0.6 : ATTENUATED_OPACITY)
    .style('pointer-events', 'none')
  // Transparent hit layer above the brush so clicks toggle a single node.
  g.selectAll('circle.hit').data(pts).join('circle').attr('class', 'hit')
    .attr('cx', d => xs(d[kCol]))
    .attr('cy', d => ys(d[kRow]))
    .attr('r', 6).attr('fill', 'transparent')
    .style('cursor', 'pointer')
    .on('click', (_, d) => selection.toggle(d.id))
    .on('mouseover', (ev, d) => showTip(tooltip, ev,
      `<strong>${d.id}</strong><br>${effNodeType(d)}<br>${MEASURE_LABELS[kCol]} ${FORMATTERS.exponential(d[kCol])}<br>${MEASURE_LABELS[kRow]} ${FORMATTERS.exponential(d[kRow])}`))
    .on('mousemove', (ev) => showTip(tooltip, ev, null))
    .on('mouseout', () => hideTip(tooltip))

  const prTxt = dd.pr == null ? 'n/a' : dd.pr.toFixed(2)
  svg.append('text')
    .attr('x', margins.left).attr('y', totalH - 6)
    .attr('font-size', '10px').attr('fill', SLATE[500])
    .text(`Spearman ρ ${dd.rho.toFixed(2)} · Pearson(log-log) ${prTxt} · n=${FORMATTERS.integer(dd.n)}`)
}

// 2D brush over the detail scatter — mirrors CentralityPanel.installScatterBrush.
// Drag rubber-bands a box; nodes whose (kx, ky) point falls inside replace the
// selection. Empty box / pure click = no-op (handled by the hit layer's toggle).
function installScatterBrush(parentG, innerW, innerH, pts, xScale, yScale, kx, ky) {
  const brushG = parentG.insert('g', ':first-child').attr('class', 'scatter-brush')
  const brush = d3.brush()
    .extent([[0, 0], [innerW, innerH]])
    .on('end', (event) => {
      if (!event.sourceEvent) return
      const sel = event.selection
      if (!sel) return
      const [[x0, y0], [x1, y1]] = sel
      const ids = []
      for (const d of pts) {
        const px = xScale(d[kx])
        const py = yScale(d[ky])
        if (px >= x0 && px <= x1 && py >= y0 && py <= y1) ids.push(d.id)
      }
      if (ids.length) selection.replace(ids)
      brushG.call(brush.move, null)
    })
  brushG.call(brush)
  brushG.select('.overlay').style('cursor', 'crosshair')
}

</script>

<template>
  <div class="flex flex-col gap-1.5 h-full">
    <Teleport v-if="controlsTarget" :to="`#${controlsTarget}`">
      <div class="grid grid-cols-2 auto-rows-min gap-1.5">
        <ControlSection title="Axes" :col-span="2">
          <ControlSwitch label="Log axes" :model-value="controls.logAxes"
            @update:model-value="updateControl('logAxes', $event)" />
        </ControlSection>
      </div>
    </Teleport>

    <Teleport v-if="theoryTarget" :to="`#${theoryTarget}`">
      <div class="flex flex-col gap-4 text-sm leading-relaxed text-secondary">

        <section class="flex flex-col gap-2">
          <h3 class="text-xs font-semibold uppercase tracking-widest text-muted">Reading this matrix</h3>
          <p>
            Each of the four <strong>centrality</strong> measures ranks nodes by a different notion of importance: <strong>PageRank</strong> (random-walk mass), <strong>Eigenvector</strong> (being connected to other central nodes), <strong>Betweenness</strong> (sitting on shortest paths — bridges), <strong>Closeness</strong> (proximity to everyone). The matrix asks: <em>do they agree on who matters?</em>
          </p>
          <p>
            The off-diagonal cells are <strong>Spearman ρ</strong>, the correlation of the two <strong>rankings</strong> (not the raw values — robust to the heavy tails centralities always have). The upper triangle shows ρ as a heat-cell, the lower triangle as a scatter of the same pair: two views of one number.
          </p>
        </section>

        <section v-if="theoryStats" class="flex flex-col gap-2">
          <h3 class="text-xs font-semibold uppercase tracking-widest text-muted">What your graph says</h3>
          <p>
            The strongest agreement is
            <button :class="theoryLinkClass(isPairOpen(theoryStats.hi.a, theoryStats.hi.b))"
              @click="openPair(theoryStats.hi.a, theoryStats.hi.b)">{{ MEASURE_LABELS[theoryStats.hi.a] }} ↔ {{ MEASURE_LABELS[theoryStats.hi.b] }}</button>
            (ρ <strong>{{ theoryStats.hi.r.toFixed(2) }}</strong>) — these two largely identify the same nodes. The weakest is
            <button :class="theoryLinkClass(isPairOpen(theoryStats.lo.a, theoryStats.lo.b))"
              @click="openPair(theoryStats.lo.a, theoryStats.lo.b)">{{ MEASURE_LABELS[theoryStats.lo.a] }} ↔ {{ MEASURE_LABELS[theoryStats.lo.b] }}</button>
            (ρ <strong>{{ theoryStats.lo.r.toFixed(2) }}</strong>) — here the two measures capture genuinely different structure, so the nodes one calls important the other may not.
          </p>
          <p>
            Click any pair above (or any cell in the matrix) to open its full scatter, where a second correlation appears: <strong>Pearson on log values</strong>, i.e. the slope of the power-law relationship — distinct from ρ, which only cares about order.
          </p>
        </section>

        <section class="flex flex-col gap-2">
          <h3 class="text-xs font-semibold uppercase tracking-widest text-muted">Axes</h3>
          <p>
            Centralities span orders of magnitude, so
            <button :class="theoryLinkClass(controls.logAxes)"
              @click="updateControl('logAxes', true)">log axes</button>
            /
            <button :class="theoryLinkClass(!controls.logAxes)"
              @click="updateControl('logAxes', false)">linear axes</button>
            change how the cloud reads: log spreads the crowded low-value mass apart and straightens power-law relationships; linear compresses everything against the few large hubs.
          </p>
        </section>

      </div>
    </Teleport>

    <div v-if="branches === 'error'" class="flex flex-1 items-center justify-center text-sm text-red-600 surface-recessed rounded-lg p-3 text-center">
      Cannot compute the comparison: {{ all.failedMeasures.value.join(', ') }} unavailable.
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
    <!-- Focus modal: the cell drill REPLACES the matrix (no grid to widen).
         A "return to global view" button restores the 4×4. -->
    <template v-if="branches === 'ready' && inFocus">
      <button
        v-if="detailPair"
        class="self-start text-[11px] text-sky-700 hover:text-sky-900 px-1"
        @click="detailPair = null"
      >← Return to global view</button>
      <div
        v-show="!detailPair"
        ref="chartContainer"
        class="chart-elev matrix-focus min-w-0 mx-auto"
        style="position: relative;"
      ></div>
      <div v-if="detailPair" class="flex flex-1 flex-col min-w-0">
        <span class="text-[11px] font-medium text-primary px-1 pb-1">
          {{ MEASURE_LABELS[detailPair[1]] }} vs {{ MEASURE_LABELS[detailPair[0]] }}
        </span>
        <div ref="detailContainer" class="chart-elev w-full min-w-0 flex-1" style="position: relative;"></div>
      </div>
    </template>

    <!-- Dashboard grid: drill opens side-by-side with the shrunk matrix. -->
    <div v-else-if="branches === 'ready'" :class="widened && detailPair ? 'grid grid-cols-2 gap-6' : ''">
      <div ref="chartContainer" class="chart-elev w-full min-w-0" style="aspect-ratio: 1/1; position: relative;"></div>
      <div v-if="widened && detailPair" class="flex flex-col min-w-0">
        <div class="flex items-center justify-between px-1 pb-1">
          <span class="text-[11px] font-medium text-primary">
            {{ MEASURE_LABELS[detailPair[1]] }} vs {{ MEASURE_LABELS[detailPair[0]] }}
          </span>
          <button class="text-[11px] text-sky-700 hover:text-sky-900" @click="detailPair = null">← close</button>
        </div>
        <div ref="detailContainer" class="chart-elev w-full min-w-0 h-full" style="position: relative;"></div>
      </div>
    </div>
  </div>
</template>

<style scoped>
/* In PanelFocus the chart box is flex-sized and collapses to its (empty)
   content height, starving the square matrix. Force a 1:1 box driven by the
   available height so min(W,H) yields a real, non-collapsing square. The
   !important overrides PanelFocus's `:deep(.chart-elev){aspect-ratio:auto}`. */
.matrix-focus {
  aspect-ratio: 1 / 1 !important;
  height: 100%;
  max-height: 100%;
  width: auto !important;
  flex: 0 1 auto !important;
}
</style>
