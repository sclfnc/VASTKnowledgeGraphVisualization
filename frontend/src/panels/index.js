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
import AttributeSchema from './AttributeSchema.vue'
import NotImplementedStub from './NotImplementedStub.vue'

// Shared defaults for the parametric AttributeSchema panel (node / edge variants).
const ATTR_SCHEMA_CONTROLS = {
  view:            { default: 'matrix' },
  highlightShared: { default: false },
  minCoverage:     { default: 0 },
}

const ATTR_SCHEMA_NODE_EXPLANATION = `Each node type carries its own bundle of attributes — sparse or dense, shared or unique. The matrix shows coverage per (type, attribute) pair: an empty cell means the attribute is undefined for that type, a saturated cell means every node of that type carries it. Hover any cell for the value summary (range / top categories / true ratio / date span). Attribute-first view flips the layout to reveal which attributes are shared across types, useful to spot cross-type comparable dimensions (e.g. release_date on both Song and Album). The shared-highlight switch makes multi-type attributes visually distinct so you can pivot the matrix mentally without changing view.`

const ATTR_SCHEMA_EDGE_EXPLANATION = `Most knowledge graphs reduce edges to a single Edge Type label, but real domains carry richer edge metadata: weight, timestamp, confidence, source, etc. The matrix shows coverage per (edge type, attribute) pair so you can see at a glance which relationships have extra annotations and which don't. When all edge types carry only Edge Type — common for VAST-style graphs — the panel says so explicitly rather than rendering an empty grid. Attribute-first view becomes useful as soon as more than one edge type shares an attribute (e.g. a timestamp present on multiple kinds of interaction).`

// Shared defaults for the 4 single-measure centrality panels; per-measure overrides spread below.
const CENTRALITY_BASE_CONTROLS = {
  view:          { default: 'specific' },
  xLog:          { default: true },
  yLog:          { default: true },
  fitLine:       { default: false },
  topKHighlight: { default: false },
}

const PAGERANK_EXPLANATION = `PageRank models a random walk biased by a damping factor: at each step the surfer follows an outgoing edge with probability 0.85, or teleports uniformly with probability 0.15. The stationary distribution sums to 1, so a node's score is its share of the total "rank mass". Use the Specific view to read concentration on the few hubs; the Generic scatter shows how PageRank deviates from raw degree.`
const EIGENVECTOR_EXPLANATION = `Eigenvector centrality is the leading eigenvector of the adjacency matrix on the largest connected component: a node is important if its neighbors are important. Diffusive influence dominates over local degree. The decay-from-core view buckets nodes by rank shell from the spectral peak; flat decay means a single core, fast decay means a star-like core-periphery.`
const BETWEENNESS_EXPLANATION = `Betweenness counts the fraction of shortest paths that pass through a node — a measure of how indispensable it is as a bridge. Heavy-tailed networks have a few "structural holes" concentrating most of the betweenness mass; the Lorenz curve makes that inequality visible at a glance, with Gini summarizing it in one number.`
const CLOSENESS_EXPLANATION = `Closeness is the inverse of the average shortest-path distance to all other reachable nodes, normalized per-component with Wasserman-Faust so values across components are comparable. Variants (undirected / out / in) honor edge direction. On directed graphs with a near-DAG structure (e.g. MC1), the out/in variants degenerate because strongly-connected components are nearly singletons — the panel falls back to a static explanation in that case.`
const COMPARISON_EXPLANATION = `The four centralities measure different aspects: PageRank (rank mass), Eigenvector (spectral diffusion), Betweenness (bridges), Closeness (proximity). Their pairwise correlations reveal which structural axes are aligned in your graph and which are independent. A scatter matrix with log axes flattens heavy tails and surfaces deviation; Spearman's rank correlation is robust to the outliers typical of centrality distributions.`

const EGO_EXPLANATION = `An ego network is the local neighborhood around a chosen node — the "ego" — together with its alters at distance up to k hops. k=1 is the immediate neighborhood; k=2 adds friends-of-friends; k=3 widens to the next shell. On directed graphs the BFS follows outgoing edges only (out-ego), since in/out semantics describe different processes and would conflate them in one view. When the neighborhood exceeds the cap, alters are sampled stratified by node type so rare types are preserved instead of being washed out by the dominant majority.`

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
      const nodeCount = schema.nodes
      const avgDegree = (data?.avg_degree || 0).toFixed(2)
      return `Degree distribution of your ${nodeCount} nodes. Average degree: ${avgDegree}. ${DEGREE_EXPLANATION}`
    },
    controlsSchema: {
      yAxis:        { default: 'count' },
      scale:        { default: 'log' },
      byType:       { default: false },
      showMean:     { default: false },
      showMedian:   { default: false },
      showIqr:      { default: false },
      showOutliers: { default: true },
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
      if (!wcc) return ''
      const lcc = wcc.lcc_size
      const total = schema?.nodes ?? 0
      const frac = total ? ((lcc / total) * 100).toFixed(1) : '?'
      return `${wcc.count} weakly connected component${wcc.count > 1 ? 's' : ''}. LCC: ${lcc} of ${total} nodes (${frac}%). ${wcc.singletons} isolated.`
    },
    controlsSchema: {
      view:           { default: 'bubbles' },
      mode:           { default: 'wcc' },
      labelMode:      { default: 'absolute' },
      hideSingletons: { default: false },
      logX:           { default: true },
      filterMode:     { default: 'range' },
      sizeMin:        { default: null },
      sizeMax:        { default: null },
      rankTop:        { default: null },
      rankBottom:     { default: null },
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

  {
    id: 'node_attrs',
    label: 'Node Attribute Schema',
    section: 'Descriptive Metrics',
    conditional: false,
    defaultActive: false,
    status: 'implemented',
    component: AttributeSchema,
    componentProps: { mode: 'node' },
    explanation: ATTR_SCHEMA_NODE_EXPLANATION,
    contextualizeExplanation: (schema) => {
      const types = schema?.node_types_detail ?? []
      const nAttrs = new Set(types.flatMap(t => t.attributes.map(a => a.name))).size
      return `${types.length} node types × ${nAttrs} distinct attributes. ${ATTR_SCHEMA_NODE_EXPLANATION}`
    },
    controlsSchema: ATTR_SCHEMA_CONTROLS,
  },

  {
    id: 'edge_attrs',
    label: 'Edge Attribute Schema',
    section: 'Descriptive Metrics',
    conditional: false,
    defaultActive: false,
    status: 'implemented',
    component: AttributeSchema,
    componentProps: { mode: 'edge' },
    explanation: ATTR_SCHEMA_EDGE_EXPLANATION,
    contextualizeExplanation: (schema) => {
      const types = schema?.edge_types_detail ?? []
      const nAttrs = new Set(types.flatMap(t => t.attributes.map(a => a.name))).size
      if (!nAttrs) return `${types.length} edge types, no additional attributes. ${ATTR_SCHEMA_EDGE_EXPLANATION}`
      return `${types.length} edge types × ${nAttrs} distinct attributes. ${ATTR_SCHEMA_EDGE_EXPLANATION}`
    },
    controlsSchema: ATTR_SCHEMA_CONTROLS,
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
    controlsSchema: {
      ...CENTRALITY_BASE_CONTROLS,
      topN:      { default: 20 },
      showTypes: { default: null },
    },
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
    controlsSchema: {
      ...CENTRALITY_BASE_CONTROLS,
      anchor: { default: 'top' },
    },
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
    controlsSchema: {
      ...CENTRALITY_BASE_CONTROLS,
      lorenzOverlay:  { default: true },
      lorenzOverlayK: { default: 5 },
    },
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
      closeSort:      { default: 'median' },
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
      logAxes:     { default: true },
      correlation: { default: 'spearman' },
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
      cap:            { default: 300 },
      direction:      { default: 'out' },
      showEdgeLabels: { default: false },
      highlight:      { default: 'type' },
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
      k:               { default: 1 },
      cap:             { default: 300 },
      direction:       { default: 'out' },
      showNonCommon:   { default: true },
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
      srcTypeFilter:  { default: null },
      dstTypeFilter:  { default: null },
      edgeTypeFilter: { default: null },
      topN:           { default: 50 },
      minFlow:        { default: 0 },
      normalize:      { default: false },
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
    explanation: `Timeline of node-level temporal attributes (creation dates, release years, etc.). Each bar is one year (or decade); the stacked breakdown shows which node types dominate each period. The brush writes a temporal filter with scope='node' that future readers can opt into.`,
    contextualizeExplanation: (schema, data) => {
      if (!data || !data.temporal_attrs_node?.length) return 'No node-level temporal attributes in this graph.'
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
    explanation: `Timeline of edge-level temporal attributes (transaction dates, rating timestamps, etc.). Stack is by edge type. Brush writes a temporal filter with scope='edge'.`,
    contextualizeExplanation: (schema, data) => {
      if (!data || !data.temporal_attrs_edge?.length) return 'No edge-level temporal attributes in this graph.'
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
