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
  // 1. Descriptive Metrics
  {
    id: 'degree',
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
