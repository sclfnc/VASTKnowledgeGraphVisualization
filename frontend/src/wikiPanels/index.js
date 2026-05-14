// Panel registry for Guide-mode D3 visualizations.
//
// Each panel has a `status`:
//   - 'implemented' — real component, fully wired
//   - 'planned'     — slated for release, component to be built (currently uses stub)
//   - 'stub'        — roadmap-only, NOT exported to the UI
//
// Stub specs are kept here as a roadmap reference but filtered out at export
// time. Promoting a stub to planned = change one field, no need to uncomment.

import DegreeDistribution from './DegreeDistribution.vue'
import ConnectedComponents from './ConnectedComponents.vue'
import NotImplementedStub from './NotImplementedStub.vue'

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
      yAxis: { type: 'select', label: 'Y-axis', options: ['count', 'probability'], default: 'count' },
      logX: { type: 'switch', label: 'Log X', default: true },
      logY: { type: 'switch', label: 'Log Y', default: true },
      byType: { type: 'boolean', label: 'By type', default: false },
      showMean: { type: 'boolean', label: 'Mean', default: false },
      showMedian: { type: 'boolean', label: 'Median', default: false },
      showIqr: { type: 'boolean', label: 'IQR / ±1σ', default: false },
      showOutliers: { type: 'boolean', label: 'Outliers', default: true },
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
      view: { type: 'select', label: 'View', options: ['bubbles', 'bars'], default: 'bubbles' },
      mode: { type: 'select', label: 'Mode', options: ['wcc', 'scc'], default: 'wcc' },
      labelMode: { type: 'select', label: 'Label', options: ['absolute', 'percentage'], default: 'absolute' },
      hideSingletons: { type: 'boolean', label: 'Hide singletons', default: false },
      logX: { type: 'switch', label: 'Log X', default: true },
      filterMode: { type: 'select', label: 'Filter mode', options: ['range', 'rank'], default: 'range' },
      sizeMin: { type: 'number', label: 'Min size', default: null },
      sizeMax: { type: 'number', label: 'Max size', default: null },
      rankTop: { type: 'number', label: 'Top N', default: null },
      rankBottom: { type: 'number', label: 'Bottom N', default: null },
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
    id: 'cent_pr_eigen',
    label: 'PageRank & Eigenvector',
    section: 'Centrality',
    conditional: false,
    status: 'planned',
    component: NotImplementedStub,
    controlsSchema: {},
  },

  {
    id: 'betweenness',
    label: 'Betweenness',
    section: 'Centrality',
    conditional: false,
    status: 'planned',
    component: NotImplementedStub,
    controlsSchema: {},
  },

  {
    id: 'closeness',
    label: 'Closeness',
    section: 'Centrality',
    conditional: false,
    status: 'planned',
    component: NotImplementedStub,
    controlsSchema: {},
  },

  {
    id: 'cent_compare',
    label: 'Centrality Comparison',
    section: 'Centrality',
    conditional: false,
    status: 'stub',
    component: NotImplementedStub,
    controlsSchema: {},
  },

  // 3. Local Structure
  {
    id: 'ego',
    label: 'Ego Network',
    section: 'Local Structure',
    conditional: false,
    status: 'planned',
    component: NotImplementedStub,
    controlsSchema: {},
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
    conditional: true,
    status: 'planned',
    component: NotImplementedStub,
    controlsSchema: {},
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

  // 7. Temporal Analysis
  {
    id: 'timeline',
    label: 'Activity Timeline',
    section: 'Temporal Analysis',
    conditional: true,
    status: 'planned',
    component: NotImplementedStub,
    controlsSchema: {},
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
