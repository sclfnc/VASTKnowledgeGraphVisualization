// EXTENSION: panel registry for the Guide view — see notebooks/first_iteration.md for the structure
const DEGREE_EXPLANATION = `P(k) is the probability that a randomly chosen node has degree k. In sparse real-world networks, degree distributions are often heavy-tailed: a few nodes (hubs) concentrate most connections while the majority have low degree. Compare the shape against a Poisson baseline (Erdős-Rényi) — a broad tail indicates structure that random wiring cannot explain.`

export const PANELS = [
  // 1. Fundamentals
  { id: 'graph_repr',    label: 'Graph Representation',    section: '1. Fundamentals',            conditional: false },
  { id: 'graph_types',   label: 'Graph Types',             section: '1. Fundamentals',            conditional: false },

  // 2. Descriptive Metrics
  { id: 'degree',        label: 'Degree Distribution',     section: '2. Descriptive Metrics',     conditional: false, defaultActive: true, explanation: DEGREE_EXPLANATION },
  { id: 'paths',         label: 'Paths & Distances',       section: '2. Descriptive Metrics',     conditional: false },
  { id: 'connectivity',  label: 'Connectivity',            section: '2. Descriptive Metrics',     conditional: false },
  { id: 'density',       label: 'Density',                 section: '2. Descriptive Metrics',     conditional: false },
  { id: 'clustering',    label: 'Clustering Coefficient',  section: '2. Descriptive Metrics',     conditional: false },
  { id: 'reciprocity',   label: 'Reciprocity',             section: '2. Descriptive Metrics',     conditional: true  },
  { id: 'edge_weight',   label: 'Edge Weight',             section: '2. Descriptive Metrics',     conditional: true  },

  // 3. Centrality
  { id: 'deg_eigen',     label: 'Degree & Eigenvector',    section: '3. Centrality',              conditional: false },
  { id: 'katz_pr',       label: 'Katz & PageRank',         section: '3. Centrality',              conditional: false },
  { id: 'between_close', label: 'Betweenness & Closeness', section: '3. Centrality',              conditional: false },
  { id: 'cent_compare',  label: 'Centrality Comparison',   section: '3. Centrality',              conditional: false },

  // 4. Local Structure
  { id: 'ego',           label: 'Ego Network',             section: '4. Local Structure',         conditional: false },
  { id: 'triadic',       label: 'Triadic Closure',         section: '4. Local Structure',         conditional: false },
  { id: 'bridges',       label: 'Bridges & Weak Ties',     section: '4. Local Structure',         conditional: false },
  { id: 'kcore',         label: 'k-Core Decomposition',    section: '4. Local Structure',         conditional: false },

  // 5. Mixing & Assortativity
  { id: 'assort',        label: 'Assortativity r',         section: '5. Mixing & Assortativity',  conditional: false },
  { id: 'deg_corr',      label: 'Degree Correlation',      section: '5. Mixing & Assortativity',  conditional: false },
  { id: 'cross_type',    label: 'Cross-type Matrix',       section: '5. Mixing & Assortativity',  conditional: true  },

  // 6. Generative Models
  { id: 'er',            label: 'ER Baseline',             section: '6. Generative Models',       conditional: false },
  { id: 'ws',            label: 'Watts-Strogatz',          section: '6. Generative Models',       conditional: false },
  { id: 'ba',            label: 'Barabási-Albert',         section: '6. Generative Models',       conditional: false },
  { id: 'model_compare', label: 'Model Comparison',        section: '6. Generative Models',       conditional: false },

  // 7. Resilience
  { id: 'random_fail',   label: 'Random Failure',          section: '7. Resilience',              conditional: false },
  { id: 'targeted',      label: 'Targeted Attack',         section: '7. Resilience',              conditional: false },
  { id: 'edge_removal',  label: 'Edge Removal',            section: '7. Resilience',              conditional: false },

  // 8. Temporal Analysis
  { id: 'timeline',      label: 'Activity Timeline',       section: '8. Temporal Analysis',       conditional: true  },
  { id: 'snapshot',      label: 'Snapshot Evolution',      section: '8. Temporal Analysis',       conditional: true  },

  // 9. Heterogeneous Structure
  { id: 'type_dist',     label: 'Type Distribution',       section: '9. Heterogeneous Structure', conditional: true  },
  { id: 'constraints',   label: 'Cross-type Constraints',  section: '9. Heterogeneous Structure', conditional: true  },
  { id: 'violations',    label: 'Semantic Violations',     section: '9. Heterogeneous Structure', conditional: true  },
]

// derive sections from registry — single source of truth, no drift
export const SECTIONS = [...new Set(PANELS.map(p => p.section))]
