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

const ALL_SPECS = [
  // A. Guide View
  // 1. Descriptive Metrics
  {
    id: 'degree',
    view: 'guide',
    label: 'Degree Distribution',
    section: 'Descriptive Metrics',
    conditional: false,
    defaultActive: true,
    status: 'implemented',
    component: DegreeDistribution,
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
    view: 'guide',
    label: 'Paths & Distances',
    section: 'Descriptive Metrics',
    conditional: false,
    status: 'stub',
    component: NotImplementedStub,
    controlsSchema: {},
  },

  {
    id: 'connectivity',
    view: 'guide',
    label: 'Connected Components',
    section: 'Descriptive Metrics',
    conditional: false,
    status: 'implemented',
    component: ConnectedComponents,
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
    view: 'guide',
    label: 'Density',
    section: 'Descriptive Metrics',
    conditional: false,
    status: 'stub',
    component: NotImplementedStub,
    controlsSchema: {},
  },

  {
    id: 'clustering',
    view: 'guide',
    label: 'Clustering Coefficient',
    section: 'Descriptive Metrics',
    conditional: false,
    status: 'stub',
    component: NotImplementedStub,
    controlsSchema: {},
  },

  {
    id: 'reciprocity',
    view: 'guide',
    label: 'Reciprocity',
    section: 'Descriptive Metrics',
    conditional: true,
    status: 'stub',
    component: NotImplementedStub,
    controlsSchema: {},
  },

  {
    id: 'edge_weight',
    view: 'guide',
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
    view: 'guide',
    label: 'PageRank',
    section: 'Centrality',
    conditional: false,
    status: 'implemented',
    component: CentralityPanel,
    componentProps: { measure: 'spectral_pagerank' },
    controlsSchema: { ...CENTRALITY_BASE_CONTROLS },
  },

  {
    id: 'cent_eigenvector',
    view: 'guide',
    label: 'Eigenvector',
    section: 'Centrality',
    conditional: false,
    status: 'implemented',
    component: CentralityPanel,
    componentProps: { measure: 'spectral_eigenvector' },
    controlsSchema: { ...CENTRALITY_BASE_CONTROLS },
  },

  {
    id: 'cent_betweenness',
    view: 'guide',
    label: 'Betweenness',
    section: 'Centrality',
    conditional: false,
    status: 'implemented',
    component: CentralityPanel,
    componentProps: { measure: 'betweenness' },
    controlsSchema: { ...CENTRALITY_BASE_CONTROLS },
  },

  {
    id: 'cent_closeness',
    view: 'guide',
    label: 'Closeness',
    section: 'Centrality',
    conditional: false,
    status: 'implemented',
    component: CentralityPanel,
    componentProps: { measure: 'closeness' },
    controlsSchema: {
      ...CENTRALITY_BASE_CONTROLS,
      closeDirection: { default: 'undirected' },
    },
  },

  {
    id: 'cent_compare',
    view: 'guide',
    label: 'Centrality Comparison',
    section: 'Centrality',
    conditional: false,
    status: 'implemented',
    component: CentralityComparison,
    controlsSchema: {
      logAxes: { default: true },
    },
  },

  // 3. Local Structure
  {
    id: 'ego',
    view: 'guide',
    label: 'Ego Network',
    section: 'Local Structure',
    conditional: false,
    status: 'implemented',
    component: EgoNetworkPanel,
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
    view: 'guide',
    label: 'Ego Comparison',
    section: 'Local Structure',
    conditional: false,
    status: 'implemented',
    component: EgoComparisonPanel,
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
    view: 'guide',
    label: 'Triadic Closure',
    section: 'Local Structure',
    conditional: false,
    status: 'stub',
    component: NotImplementedStub,
    controlsSchema: {},
  },

  {
    id: 'kcore',
    view: 'guide',
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
    view: 'guide',
    label: 'Assortativity r',
    section: 'Mixing & Assortativity',
    conditional: false,
    status: 'stub',
    component: NotImplementedStub,
    controlsSchema: {},
  },

  {
    id: 'deg_corr',
    view: 'guide',
    label: 'Degree Correlation',
    section: 'Mixing & Assortativity',
    conditional: false,
    status: 'stub',
    component: NotImplementedStub,
    controlsSchema: {},
  },

  {
    id: 'type_mixing',
    view: 'guide',
    label: 'Type Mixing Matrix',
    section: 'Mixing & Assortativity',
    conditional: false,
    defaultActive: false,
    status: 'implemented',
    component: TypeMixingMatrix,
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
    view: 'guide',
    label: 'Edge Type Flow',
    section: 'Mixing & Assortativity',
    conditional: false,
    defaultActive: false,
    status: 'implemented',
    component: EdgeFlow,
    controlsSchema: {
      hiddenTypes:    { default: [] },
      hideSelfLoops:  { default: false },
    },
  },

  // 5. Generative Models
  {
    id: 'er',
    view: 'guide',
    label: 'ER Baseline',
    section: 'Generative Models',
    conditional: false,
    status: 'stub',
    component: NotImplementedStub,
    controlsSchema: {},
  },

  {
    id: 'ws',
    view: 'guide',
    label: 'Watts-Strogatz',
    section: 'Generative Models',
    conditional: false,
    status: 'stub',
    component: NotImplementedStub,
    controlsSchema: {},
  },

  {
    id: 'ba',
    view: 'guide',
    label: 'Barabási-Albert',
    section: 'Generative Models',
    conditional: false,
    status: 'stub',
    component: NotImplementedStub,
    controlsSchema: {},
  },

  {
    id: 'model_compare',
    view: 'guide',
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
    view: 'guide',
    label: 'Random Failure',
    section: 'Resilience',
    conditional: false,
    status: 'stub',
    component: NotImplementedStub,
    controlsSchema: {},
  },

  {
    id: 'targeted',
    view: 'guide',
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
    view: 'guide',
    label: 'Activity Timeline · Nodes',
    section: 'Temporal Analysis',
    conditional: false,
    defaultActive: false,
    status: 'implemented',
    component: ActivityTimeline,
    componentProps: { mode: 'node' },
    // Excluded from the dashboard when the graph has no node-level temporal attr.
    available: (schema) => (schema?.temporal_attrs_node?.length ?? 0) > 0,
    controlsSchema: {
      attr:      { default: null },
      breakdown: { default: 'type' },
      binSize: { default: 'year' },
    },
  },
  {
    id: 'timeline_edge',
    view: 'guide',
    label: 'Activity Timeline · Edges',
    section: 'Temporal Analysis',
    conditional: false,
    defaultActive: false,
    status: 'implemented',
    component: ActivityTimeline,
    componentProps: { mode: 'edge' },
    // Excluded from the dashboard when the graph has no edge-level temporal attr.
    available: (schema) => (schema?.temporal_attrs_edge?.length ?? 0) > 0,
    controlsSchema: {
      attr:      { default: null },
      breakdown: { default: 'type' },
      binSize:   { default: 'year' },
    },
  },

  // 8. Heterogeneous Structure
  {
    id: 'type_dist',
    view: 'guide',
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
    view: 'guide',
    label: 'Modularity',
    section: 'Community Detection',
    conditional: false,
    status: 'stub',
    component: NotImplementedStub,
    controlsSchema: {},
  },

  {
    id: 'louvain',
    view: 'guide',
    label: 'Louvain & Leiden',
    section: 'Community Detection',
    conditional: false,
    status: 'stub',
    component: NotImplementedStub,
    controlsSchema: {},
  },

  {
    id: 'label_prop',
    view: 'guide',
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
    view: 'guide',
    label: 'Similarity Indices',
    section: 'Link Prediction',
    conditional: false,
    status: 'stub',
    component: NotImplementedStub,
    controlsSchema: {},
  },

  // B. Graph View
  {
    id: 'graph_node_link',
    view: 'graph',
    label: 'Node-Link Diagram',
    active: true,
    section: 'Main',
    defaultActive: true,
    conditional: false,
    status: 'planned',
    component: NotImplementedStub,
    controlsSchema: {},
    order: 'first',
  },
  {
    id: 'graph_ego',
    view: 'graph',
    label: 'Ego Network',
    section: 'Main',
    defaultActive: true,
    conditional: false,
    status: 'planned',
    component: NotImplementedStub,
    controlsSchema: {},
    order: 'last',
  },
  {
    id: 'graph_flows',
    view: 'graph',
    label: 'Edge Flows',
    section: 'Edge Overview',
    defaultActive: true,
    conditional: false,
    status: 'planned',
    component: NotImplementedStub,
    controlsSchema: {},
    resizable: false,
  },
  {
    id: 'graph_edge_types',
    label: 'Edge Types',
    view: 'graph',
    section: 'Edge Overview',
    defaultActive: true,
    conditional: false,
    status: 'implemented',
    component: NotImplementedStub,
    controlsSchema: {
      view: { default: 'all' },
    },
    resizable: false
  },
]

export const PANEL_SPECS = ALL_SPECS.filter(p => p.status !== 'stub')
export const SECTIONS = [...new Set(PANEL_SPECS.map(p => p.section))]
