// Panel registry; status ∈ {implemented, planned, stub}. Stubs are filtered out at export.

import DegreeDistribution from './DegreeDistribution.vue'
import ConnectedComponents from './ConnectedComponents.vue'
import CentralityPanel from './CentralityPanel.vue'
import CentralityComparison from './CentralityComparison.vue'
import EgoNetworkPanel from './EgoNetworkPanel.vue'
import EgoComparisonPanel from './EgoComparisonPanel.vue'
import EdgeFlow from './EdgeFlow.vue'
import TypeMixingMatrix from './TypeMixingMatrix.vue'
import ActivityTimeline from './ActivityTimeline.vue'
import NotImplementedStub from './NotImplementedStub.vue'

// Shared defaults for the 4 single-measure centrality panels; per-measure overrides spread below.
// `showTypes` is shared: it governs the type subset for the "vs Degree" scatter
// on all four measures, and additionally drives the PageRank "By Measure" bars.
// null = all types active.
const CENTRALITY_BASE_CONTROLS = {
  view:          { default: 'specific' },
  xLog:          { default: true },
  yLog:          { default: true },
  showTypes:     { default: null },
  // All four measures share the rank-mass bars → Top N is a base control.
  topN:          { default: 20 },
}

const PAGERANK_EXPLANATION = `PageRank models a random walk biased by a damping factor: at each step the surfer follows an outgoing edge with probability 0.85, or teleports uniformly with probability 0.15. The stationary distribution sums to 1, so a node's score is its share of the total "rank mass". Use the Specific view to read concentration on the few hubs; the Generic scatter shows how PageRank deviates from raw degree.`
const EIGENVECTOR_EXPLANATION = `Eigenvector centrality is the leading eigenvector of the adjacency matrix on the largest connected component: a node is important if its neighbors are important. Diffusive influence dominates over local degree. The By-Measure bars rank nodes by their share of the total eigenvector mass — a few long bars over a flat tail mark a tight spectral core; the vs-Degree scatter shows how far eigenvector deviates from raw degree.`
const BETWEENNESS_EXPLANATION = `Betweenness counts the fraction of shortest paths that pass through a node — a measure of how indispensable it is as a bridge. Heavy-tailed networks have a few "structural holes" concentrating most of the betweenness mass; the Lorenz curve makes that inequality visible at a glance, with Gini summarizing it in one number.`
const CLOSENESS_EXPLANATION = `Closeness is the inverse of the average shortest-path distance to all other reachable nodes, normalized per-component with Wasserman-Faust so values across components are comparable. Variants (undirected / out / in) honor edge direction. On directed graphs with a near-DAG structure (e.g. MC1), the out/in variants degenerate because strongly-connected components are nearly singletons — the panel falls back to a static explanation in that case.`
const COMPARISON_EXPLANATION = `The four centralities measure different aspects: PageRank (rank mass), Eigenvector (spectral diffusion), Betweenness (bridges), Closeness (proximity). Their pairwise correlations reveal which structural axes are aligned in your graph and which are independent. A scatter matrix with log axes flattens heavy tails and surfaces deviation; Spearman's rank correlation is robust to the outliers typical of centrality distributions.`

const EGO_EXPLANATION = `An ego network is the local neighborhood around a chosen node — the "ego" — together with its alters at distance up to k hops. k=1 is the immediate neighborhood; k=2 adds friends-of-friends; k=3 widens to the next shell. On directed graphs a Direction control (out / in / both) selects which edges the BFS follows, since in/out semantics describe different processes. When the neighborhood exceeds the cap, alters are sampled stratified by node type so rare types are preserved instead of being washed out by the dominant majority. Drag nodes to untangle the layout, drag the background to pan, scroll to zoom.`

const EGO_COMPARISON_EXPLANATION = `Comparing multiple ego networks reveals whether nodes appear in one neighborhood, several, or all of them — the structural overlap between distinct local universes. Each ego gets a distinct hue; nodes shared across ego networks render as a pie of their layers, so a fully multi-colored node sits at the intersection of every chosen ego. The "Show non-common nodes" toggle lets you switch between the union view (context: how big each neighborhood is, where the intersection sits inside them) and the intersection-only view (focus: is the overlap dense and connected, or a sparse coincidence?). Up to 4 egos can be compared at once — beyond that the multi-hue encoding becomes unreadable.`

const DEGREE_EXPLANATION = `P(k) is the probability that a randomly chosen node has degree k. In sparse real-world networks, degree distributions are often heavy-tailed: a few nodes (hubs) concentrate most connections while the majority have low degree. Compare the shape against a Poisson baseline (Erdős-Rényi) — a broad tail indicates structure that random wiring cannot explain.`

const ALL_SPECS = [
  // 1. Descriptive Metrics
  {
    id: 'degree',
    label: 'Degree Distribution',
    section: 'Descriptive Metrics',
    conditional: false,
    defaultActive: true,
    status: 'implemented',
    explanation: DEGREE_EXPLANATION,
    component: DegreeDistribution,
    contextualizeExplanation: (schema, data) => {
      if (!data) return null  // PanelFocus has no data; fall back to static explanation
      const nodeCount = schema.nodes
      const avgDegree = (data.avg_degree || 0).toFixed(2)
      return `Degree distribution of your ${nodeCount} nodes. Average degree: ${avgDegree}. ${DEGREE_EXPLANATION}`
    },
    controlsSchema: {
      yAxis:        { default: 'count' },
      scale:        { default: 'log' },
      byType:       { default: false },
      showMedian:   { default: false },
      showIqr:      { default: false },
    },
  },

  {
    id: 'paths',
    label: 'Paths & Distances',
    section: 'Descriptive Metrics',
    conditional: false,
    status: 'stub',
    component: NotImplementedStub,
    controlsSchema: {},
  },

  {
    id: 'connectivity',
    label: 'Connected Components',
    section: 'Descriptive Metrics',
    conditional: false,
    status: 'implemented',
    component: ConnectedComponents,
    explanation: `Connected components reveal whether the graph is one piece or many. The largest one (LCC) typically dominates real-world networks: if it covers most nodes, the graph is essentially connected. The number of components, their sizes, and how many nodes are isolated tell you how fragmented the structure is. For directed graphs, weakly connected components (WCC) ignore direction; strongly connected components (SCC) require a directed path both ways.`,
    contextualizeExplanation: (schema, data) => {
      const wcc = data?.wcc
      if (!wcc) return null  // PanelFocus / pre-fetch → fall back to static
      const lcc = wcc.lcc_size
      const total = schema?.nodes ?? 0
      const frac = total ? ((lcc / total) * 100).toFixed(1) : '?'
      return `${wcc.count} weakly connected component${wcc.count > 1 ? 's' : ''}. LCC: ${lcc} of ${total} nodes (${frac}%). ${wcc.singletons} isolated.`
    },
    controlsSchema: {
      view:           { default: 'bubbles' },
      mode:           { default: 'wcc' },
      // Size-rank window: [loRank, hiRank], 1-based over the distinct size groups
      // (rank 1 = largest). null = no rank filter. A dual-handle slider unifies
      // the old Top/Bottom toggle: [1,3] = three largest, [N-1,N] = two smallest.
      rankRange:      { default: null },
    },
  },

  {
    id: 'density',
    label: 'Density',
    section: 'Descriptive Metrics',
    conditional: false,
    status: 'stub',
    component: NotImplementedStub,
    controlsSchema: {},
  },

  {
    id: 'clustering',
    label: 'Clustering Coefficient',
    section: 'Descriptive Metrics',
    conditional: false,
    status: 'stub',
    component: NotImplementedStub,
    controlsSchema: {},
  },

  {
    id: 'reciprocity',
    label: 'Reciprocity',
    section: 'Descriptive Metrics',
    conditional: true,
    status: 'stub',
    component: NotImplementedStub,
    controlsSchema: {},
  },

  {
    id: 'edge_weight',
    label: 'Edge Weight',
    section: 'Descriptive Metrics',
    conditional: true,
    status: 'stub',
    component: NotImplementedStub,
    controlsSchema: {},
  },


  // 2. Centrality
  {
    id: 'cent_pagerank',
    label: 'PageRank',
    section: 'Centrality',
    conditional: false,
    status: 'implemented',
    component: CentralityPanel,
    componentProps: { measure: 'spectral_pagerank' },
    explanation: PAGERANK_EXPLANATION,
    controlsSchema: { ...CENTRALITY_BASE_CONTROLS },
  },

  {
    id: 'cent_eigenvector',
    label: 'Eigenvector',
    section: 'Centrality',
    conditional: false,
    status: 'implemented',
    component: CentralityPanel,
    componentProps: { measure: 'spectral_eigenvector' },
    explanation: EIGENVECTOR_EXPLANATION,
    controlsSchema: { ...CENTRALITY_BASE_CONTROLS },
  },

  {
    id: 'cent_betweenness',
    label: 'Betweenness',
    section: 'Centrality',
    conditional: false,
    status: 'implemented',
    component: CentralityPanel,
    componentProps: { measure: 'betweenness' },
    explanation: BETWEENNESS_EXPLANATION,
    controlsSchema: { ...CENTRALITY_BASE_CONTROLS },
  },

  {
    id: 'cent_closeness',
    label: 'Closeness',
    section: 'Centrality',
    conditional: false,
    status: 'implemented',
    component: CentralityPanel,
    componentProps: { measure: 'closeness' },
    explanation: CLOSENESS_EXPLANATION,
    controlsSchema: {
      ...CENTRALITY_BASE_CONTROLS,
      closeDirection: { default: 'undirected' },
    },
  },

  {
    id: 'cent_compare',
    label: 'Centrality Comparison',
    section: 'Centrality',
    conditional: false,
    status: 'implemented',
    component: CentralityComparison,
    explanation: COMPARISON_EXPLANATION,
    controlsSchema: {
      logAxes: { default: true },
    },
  },

  // 3. Local Structure
  {
    id: 'ego',
    label: 'Ego Network',
    section: 'Local Structure',
    conditional: false,
    status: 'implemented',
    component: EgoNetworkPanel,
    explanation: EGO_EXPLANATION,
    // Defaults-only; drawer is composed manually inside the component.
    controlsSchema: {
      k:              { default: 1 },
      cap:            { default: 150 },
      direction:      { default: 'both' },
      highlight:      { default: 'type' },
      highlightTypes: { default: [] },
      linkDistance:   { default: 40 },
      chargeStrength: { default: -150 },
    },
  },

  {
    id: 'ego_compare',
    label: 'Ego Comparison',
    section: 'Local Structure',
    conditional: false,
    status: 'implemented',
    component: EgoComparisonPanel,
    explanation: EGO_COMPARISON_EXPLANATION,
    controlsSchema: {
      cap:             { default: 150 },
      direction:       { default: 'both' },
      showNonCommon:   { default: true },
      layout:          { default: 'force' },
      vennSpread:      { default: 1.0 },
      vennOverlap:     { default: 1.12 },
      highlightTypes:  { default: [] },
      linkDistance:    { default: 40 },
      chargeStrength:  { default: -150 },
    },
  },

  {
    id: 'triadic',
    label: 'Triadic Closure',
    section: 'Local Structure',
    conditional: false,
    status: 'stub',
    component: NotImplementedStub,
    controlsSchema: {},
  },

  {
    id: 'kcore',
    label: 'k-Core Decomposition',
    section: 'Local Structure',
    conditional: false,
    status: 'stub',
    component: NotImplementedStub,
    controlsSchema: {},
  },

  // 4. Mixing & Assortativity
  {
    id: 'assort',
    label: 'Assortativity r',
    section: 'Mixing & Assortativity',
    conditional: false,
    status: 'stub',
    component: NotImplementedStub,
    controlsSchema: {},
  },

  {
    id: 'deg_corr',
    label: 'Degree Correlation',
    section: 'Mixing & Assortativity',
    conditional: false,
    status: 'stub',
    component: NotImplementedStub,
    controlsSchema: {},
  },

  {
    id: 'type_mixing',
    label: 'Type Mixing Matrix',
    section: 'Mixing & Assortativity',
    conditional: false,
    defaultActive: false,
    status: 'implemented',
    component: TypeMixingMatrix,
    explanation: `The type mixing matrix shows how edges (or 1-hop neighbor sets) distribute across pairs of node types. A diagonal-heavy matrix means nodes preferentially connect within their own type (assortative); off-diagonal concentration signals cross-type bridging. The Newman assortativity coefficient r summarises this in a single number: r≈1 perfectly assortative, r≈-1 perfectly disassortative, r≈0 random. Because real-world graphs are often multi/directed, r is computed on a simple+undirected projection so its scale matches the canonical definition; the panel reports both the overall r and a per-edge-type breakdown.`,
    contextualizeExplanation: (schema) => {
      const nt = schema?.node_types?.length ?? 0
      if (nt < 2) return 'Only one node type in this graph — the matrix collapses to a single cell.'
      return `${nt}×${nt} matrix across ${nt} node types. ${schema?.directed ? 'Directed graph: rows = source type, columns = target type.' : 'Undirected graph: matrix is symmetric by construction.'}`
    },
    controlsSchema: {
      mode:           { default: 'edges' },
      normalize:      { default: 'none' },
      edgeTypeFilter: { default: null },
      maxTypes:       { default: 12 },
      sort:           { default: 'volume' },
    },
  },

  {
    id: 'edge_flow',
    label: 'Edge Type Flow',
    section: 'Mixing & Assortativity',
    conditional: false,
    defaultActive: false,
    status: 'implemented',
    component: EdgeFlow,
    explanation: `The edge type flow shows how relationships route through the graph at the node-type level: each meta-node is a node type (size = count of nodes), each arc is an edge type (width = count, color = edge type, direction = arrow on directed graphs; self-loops appear as curved arcs on the type itself). This compact view scales to dense schemas where a Sankey would become an unreadable hairball, and it handles cycles natively. Filter by source/target/edge type and threshold on minimum flow to focus on the structurally important relationships.`,
    contextualizeExplanation: (schema) => {
      const nt = schema?.node_types?.length ?? 0
      const et = schema?.edge_types?.length ?? 0
      return `${nt} node types × ${et} edge types. ${schema?.directed ? 'Directed: arrows show source→target.' : 'Undirected: arcs without direction; each pair counted once.'}`
    },
    controlsSchema: {
      hiddenTypes:    { default: [] },
      hideSelfLoops:  { default: false },
    },
  },

  // 5. Generative Models
  {
    id: 'er',
    label: 'ER Baseline',
    section: 'Generative Models',
    conditional: false,
    status: 'stub',
    component: NotImplementedStub,
    controlsSchema: {},
  },

  {
    id: 'ws',
    label: 'Watts-Strogatz',
    section: 'Generative Models',
    conditional: false,
    status: 'stub',
    component: NotImplementedStub,
    controlsSchema: {},
  },

  {
    id: 'ba',
    label: 'Barabási-Albert',
    section: 'Generative Models',
    conditional: false,
    status: 'stub',
    component: NotImplementedStub,
    controlsSchema: {},
  },

  {
    id: 'model_compare',
    label: 'Model Comparison',
    section: 'Generative Models',
    conditional: false,
    status: 'stub',
    component: NotImplementedStub,
    controlsSchema: {},
  },

  // 6. Resilience
  {
    id: 'random_fail',
    label: 'Random Failure',
    section: 'Resilience',
    conditional: false,
    status: 'stub',
    component: NotImplementedStub,
    controlsSchema: {},
  },

  {
    id: 'targeted',
    label: 'Targeted Attack',
    section: 'Resilience',
    conditional: false,
    status: 'stub',
    component: NotImplementedStub,
    controlsSchema: {},
  },

  // 7. Temporal Analysis (two scopes share one parametric component)
  {
    id: 'timeline_node',
    label: 'Activity Timeline · Nodes',
    section: 'Temporal Analysis',
    conditional: false,
    defaultActive: false,
    status: 'implemented',
    component: ActivityTimeline,
    componentProps: { mode: 'node' },
    // Excluded from the dashboard when the graph has no node-level temporal attr.
    available: (schema) => (schema?.temporal_attrs_node?.length ?? 0) > 0,
    explanation: `Timeline of node-level temporal attributes (creation dates, release years, etc.). Each bar is one year (or decade); the stacked breakdown shows which node types dominate each period. The brush writes a temporal filter with scope='node' that future readers can opt into.`,
    contextualizeExplanation: (schema, data) => {
      if (!data) return null  // PanelFocus → static fallback
      if (!data.temporal_attrs_node?.length) return 'No node-level temporal attributes in this graph.'
      return `Node temporal attributes: ${data.temporal_attrs_node.join(', ')}.`
    },
    controlsSchema: {
      attr:      { default: null },
      breakdown: { default: 'type' },
      binSize:   { default: 'year' },
    },
  },
  {
    id: 'timeline_edge',
    label: 'Activity Timeline · Edges',
    section: 'Temporal Analysis',
    conditional: false,
    defaultActive: false,
    status: 'implemented',
    component: ActivityTimeline,
    componentProps: { mode: 'edge' },
    // Excluded from the dashboard when the graph has no edge-level temporal attr.
    available: (schema) => (schema?.temporal_attrs_edge?.length ?? 0) > 0,
    explanation: `Timeline of edge-level temporal attributes (transaction dates, rating timestamps, etc.). Stack is by edge type. Brush writes a temporal filter with scope='edge'.`,
    contextualizeExplanation: (schema, data) => {
      if (!data) return null  // PanelFocus → static fallback
      if (!data.temporal_attrs_edge?.length) return 'No edge-level temporal attributes in this graph.'
      return `Edge temporal attributes: ${data.temporal_attrs_edge.join(', ')}.`
    },
    controlsSchema: {
      attr:      { default: null },
      breakdown: { default: 'type' },
      binSize:   { default: 'year' },
    },
  },

  // 8. Heterogeneous Structure
  {
    id: 'type_dist',
    label: 'Type Distribution',
    section: 'Heterogeneous Structure',
    conditional: true,
    status: 'stub',
    component: NotImplementedStub,
    controlsSchema: {},
  },

  // 9. Community Detection
  {
    id: 'modularity',
    label: 'Modularity',
    section: 'Community Detection',
    conditional: false,
    status: 'stub',
    component: NotImplementedStub,
    controlsSchema: {},
  },

  {
    id: 'louvain',
    label: 'Louvain & Leiden',
    section: 'Community Detection',
    conditional: false,
    status: 'stub',
    component: NotImplementedStub,
    controlsSchema: {},
  },

  {
    id: 'label_prop',
    label: 'Label Propagation',
    section: 'Community Detection',
    conditional: false,
    status: 'stub',
    component: NotImplementedStub,
    controlsSchema: {},
  },

  // 10. Link Prediction
  {
    id: 'similarity',
    label: 'Similarity Indices',
    section: 'Link Prediction',
    conditional: false,
    status: 'stub',
    component: NotImplementedStub,
    controlsSchema: {},
  },
]

export const PANEL_SPECS = ALL_SPECS.filter(p => p.status !== 'stub')
export const SECTIONS = [...new Set(PANEL_SPECS.map(p => p.section))]
