// Panel registry for interactive D3 visualizations
// Each panel: id, label, section, conditional, defaultActive, component, schema builder, controls schema

import DegreeDistribution from './DegreeDistribution.vue'
import Reciprocity from './Reciprocity.vue'
import EdgeWeight from './EdgeWeight.vue'
import Assortativity from './Assortativity.vue'
import DegreeCorrelation from './DegreeCorrelation.vue'
import TypeMixing from './TypeMixing.vue'
import TypeDistribution from './TypeDistribution.vue'
import ErBaseline from './ErBaseline.vue'
import WattsStrogatz from './WattsStrogatz.vue'
import BarabasiAlbert from './BarabasiAlbert.vue'
import ModelComparison from './ModelComparison.vue'
import Centrality from './Centrality.vue'
import CentralityComparison from './CentralityComparison.vue'
import Modularity from './Modularity.vue'
import LouvainLeiden from './LouvainLeiden.vue'
import LabelPropagation from './LabelPropagation.vue'
import SimilarityIndices from './SimilarityIndices.vue'
import EgoNetwork from './EgoNetwork.vue'
import TriadicClosure from './TriadicClosure.vue'
import KCoreDecomposition from './KCoreDecomposition.vue'
import Connectivity from './Connectivity.vue'
import Density from './Density.vue'
import ClusteringCoefficient from './ClusteringCoefficient.vue'
import Paths from './Paths.vue'
import RandomFailure from './RandomFailure.vue'
import TargetedAttack from './TargetedAttack.vue'
import Timeline from './Timeline.vue'

const DEGREE_EXPLANATION = `P(k) is the probability that a randomly chosen node has degree k. In sparse real-world networks, degree distributions are often heavy-tailed: a few nodes (hubs) concentrate most connections while the majority have low degree. Compare the shape against a Poisson baseline (Erdős-Rényi) — a broad tail indicates structure that random wiring cannot explain.`

export const PANEL_SPECS = [
  // 1. Fundamentals (text-only, not in wikiPanels)
  // { id: 'graph_repr',    label: 'Graph Representation',    section: '1. Fundamentals',            conditional: false },
  // { id: 'graph_types',   label: 'Graph Types',             section: '1. Fundamentals',            conditional: false },

  // 2. Descriptive Metrics
  {
    id: 'degree',
    label: 'Degree Distribution',
    section: '2. Descriptive Metrics',
    conditional: false,
    defaultActive: true,
    explanation: DEGREE_EXPLANATION,
    component: DegreeDistribution,
    contextualizeExplanation: (schema, data) => {
      const nodeCount = schema.nodes
      const avgDegree = (data?.avg_degree || 0).toFixed(2)
      return `Degree distribution of your ${nodeCount} nodes. Average degree: ${avgDegree}. ${DEGREE_EXPLANATION}`
    },
    controlsSchema: {
      logX: { type: 'switch', label: 'Log X', default: false },
      logY: { type: 'switch', label: 'Log Y', default: false },
      byType: { type: 'boolean', label: 'By type', default: false },
      showMean: { type: 'boolean', label: 'Mean', default: true },
      showMedian: { type: 'boolean', label: 'Median', default: true },
      showIqr: { type: 'boolean', label: 'IQR / ±1σ', default: true },
      showOutliers: { type: 'boolean', label: 'Outliers', default: true },
      showInliers: { type: 'boolean', label: 'Inliers', default: true },
      colorOutliers: { type: 'boolean', label: 'Color outliers', default: false },
    }
  },

  {
    id: 'paths',
    label: 'Paths & Distances',
    section: '2. Descriptive Metrics',
    conditional: false,
    component: Paths,
    contextualizeExplanation: (schema, data) => {
      const diameter = data?.diameter || '-'
      const avgPath = (data?.avg_shortest_path || 0).toFixed(2)
      return `Shortest path distances in your graph. Diameter: ${diameter}, Average: ${avgPath} hops.`
    },
    controlsSchema: {
      showDistribution: {
        type: 'boolean',
        label: 'Show Distribution',
        default: true
      },
      maxDistance: {
        type: 'number',
        label: 'Max Distance',
        min: 1,
        max: 50,
        default: 10
      }
    }
  },

  {
    id: 'connectivity',
    label: 'Connectivity',
    section: '2. Descriptive Metrics',
    conditional: false,
    component: Connectivity,
    contextualizeExplanation: (schema, data) => {
      const wcc = data?.weakly_connected_components || 1
      return `Connected component structure. Your graph has ${wcc} weakly connected components.`
    },
    controlsSchema: {
      highlightLcc: {
        type: 'boolean',
        label: 'Highlight LCC',
        default: true
      }
    }
  },

  {
    id: 'density',
    label: 'Density',
    section: '2. Descriptive Metrics',
    conditional: false,
    component: Density,
    contextualizeExplanation: (schema, data) => {
      const dens = (data?.density || 0).toFixed(4)
      return `Edge density (actual edges / possible edges). Your graph: ${dens}.`
    },
    controlsSchema: {}
  },

  {
    id: 'clustering',
    label: 'Clustering Coefficient',
    section: '2. Descriptive Metrics',
    conditional: false,
    component: ClusteringCoefficient,
    contextualizeExplanation: (schema, data) => {
      const global = (data?.global_clustering || 0).toFixed(3)
      return `Proportion of closed triangles. Global clustering coefficient: ${global}.`
    },
    controlsSchema: {
      byNodeType: {
        type: 'boolean',
        label: 'Break down by node type',
        default: false
      }
    }
  },

  {
    id: 'reciprocity',
    label: 'Reciprocity',
    section: '2. Descriptive Metrics',
    conditional: true,
    component: Reciprocity,
    contextualizeExplanation: (schema, data) => {
      const recip = (data?.reciprocity || 0).toFixed(3)
      return `Fraction of reciprocated edges in your directed graph: ${recip}.`
    },
    controlsSchema: {
      showByEdgeType: {
        type: 'boolean',
        label: 'Show by edge type',
        default: true
      }
    }
  },

  {
    id: 'edge_weight',
    label: 'Edge Weight',
    section: '2. Descriptive Metrics',
    conditional: true,
    component: EdgeWeight,
    contextualizeExplanation: (schema, data) => {
      const range = data?.weight_range || [0, 1]
      return `Weight distribution. Range: [${range[0]}, ${range[1]}].`
    },
    controlsSchema: {
      scale: {
        type: 'select',
        label: 'Scale',
        options: ['linear', 'log', 'sqrt'],
        default: 'linear'
      }
    }
  },

  // 3. Centrality
  {
    id: 'deg_eigen',
    label: 'Degree & Eigenvector',
    section: '3. Centrality',
    conditional: false,
    component: Centrality,
    contextualizeExplanation: (schema, data) => {
      return `Comparison of degree centrality vs eigenvector centrality on your ${schema.nodes} nodes.`
    },
    controlsSchema: {
      colorBy: {
        type: 'select',
        label: 'Color by',
        options: ['degree', 'eigenvector', 'difference'],
        default: 'degree'
      }
    }
  },

  {
    id: 'between_close',
    label: 'Betweenness & Closeness',
    section: '3. Centrality',
    conditional: false,
    component: Centrality,
    contextualizeExplanation: (schema, data) => {
      return `Betweenness (how often a node lies on shortest paths) vs Closeness (avg distance to all others).`
    },
    controlsSchema: {
      metric: {
        type: 'select',
        label: 'Metric',
        options: ['betweenness', 'closeness', 'both'],
        default: 'both'
      }
    }
  },

  {
    id: 'cent_compare',
    label: 'Centrality Comparison',
    section: '3. Centrality',
    conditional: false,
    component: CentralityComparison,
    contextualizeExplanation: (schema, data) => {
      return `Multi-dimensional centrality: degree, eigenvector, betweenness, closeness, PageRank.`
    },
    controlsSchema: {
      displayMode: {
        type: 'select',
        label: 'View',
        options: ['scatterplot-matrix', 'radar', 'heatmap'],
        default: 'scatterplot-matrix'
      },
      topK: {
        type: 'number',
        label: 'Top-K nodes',
        min: 5,
        max: 100,
        default: 20
      }
    }
  },

  // 4. Local Structure
  {
    id: 'ego',
    label: 'Ego Network',
    section: '4. Local Structure',
    conditional: false,
    component: EgoNetwork,
    contextualizeExplanation: (schema, data) => {
      return `Local neighborhood of a selected node (ego + alters + edges between them).`
    },
    controlsSchema: {
      egoNode: {
        type: 'text',
        label: 'Ego node ID',
        default: ''
      },
      hops: {
        type: 'number',
        label: 'Hops',
        min: 1,
        max: 3,
        default: 1
      }
    }
  },

  {
    id: 'triadic',
    label: 'Triadic Closure',
    section: '4. Local Structure',
    conditional: false,
    component: TriadicClosure,
    contextualizeExplanation: (schema, data) => {
      return `Tendency for triangles to form (triadic closure). Indicates cohesion and trust in social networks.`
    },
    controlsSchema: {
      byNodeType: {
        type: 'boolean',
        label: 'Breakdown by node type',
        default: false
      }
    }
  },

  {
    id: 'kcore',
    label: 'k-Core Decomposition',
    section: '4. Local Structure',
    conditional: false,
    component: KCoreDecomposition,
    contextualizeExplanation: (schema, data) => {
      const maxK = data?.max_kcore || 0
      return `Coreness values (max k: ${maxK}). Nodes in higher k-cores are more densely connected.`
    },
    controlsSchema: {
      minK: {
        type: 'number',
        label: 'Min k',
        min: 0,
        max: 50,
        default: 0
      },
      showDistribution: {
        type: 'boolean',
        label: 'Show distribution',
        default: true
      }
    }
  },

  // 5. Mixing & Assortativity
  {
    id: 'assort',
    label: 'Assortativity r',
    section: '5. Mixing & Assortativity',
    conditional: false,
    component: Assortativity,
    contextualizeExplanation: (schema, data) => {
      const r = (data?.assortativity || 0).toFixed(3)
      return `Pearson correlation of degrees at edge endpoints: ${r}. Positive = assortative (hubs connect to hubs).`
    },
    controlsSchema: {
      byNodeType: {
        type: 'boolean',
        label: 'Show by node type',
        default: false
      }
    }
  },

  {
    id: 'deg_corr',
    label: 'Degree Correlation',
    section: '5. Mixing & Assortativity',
    conditional: false,
    component: DegreeCorrelation,
    contextualizeExplanation: (schema, data) => {
      return `Joint distribution of source and target degrees. Reveals mixing patterns.`
    },
    controlsSchema: {
      scale: {
        type: 'select',
        label: 'Scale',
        options: ['linear', 'log'],
        default: 'linear'
      }
    }
  },

  {
    id: 'type_mixing',
    label: 'Type Mixing Matrix',
    section: '5. Mixing & Assortativity',
    conditional: true,
    component: TypeMixing,
    contextualizeExplanation: (schema, data) => {
      const nodeTypes = (schema.node_types || []).length
      return `Edge counts between node types. ${nodeTypes} node types detected.`
    },
    controlsSchema: {
      normalization: {
        type: 'select',
        label: 'Normalize',
        options: ['raw', 'row', 'column', 'total'],
        default: 'raw'
      },
      hideZeros: {
        type: 'boolean',
        label: 'Hide zeros',
        default: false
      }
    }
  },

  // 6. Generative Models
  {
    id: 'er',
    label: 'ER Baseline',
    section: '6. Generative Models',
    conditional: false,
    component: ErBaseline,
    contextualizeExplanation: (schema, data) => {
      return `Erdős-Rényi random graph (same N, E). Baseline for comparing degree distribution.`
    },
    controlsSchema: {
      samples: {
        type: 'number',
        label: 'Sample graphs',
        min: 1,
        max: 100,
        default: 10
      }
    }
  },

  {
    id: 'ws',
    label: 'Watts-Strogatz',
    section: '6. Generative Models',
    conditional: false,
    component: WattsStrogatz,
    contextualizeExplanation: (schema, data) => {
      return `Small-world model: regular lattice rewired randomly. Balances clustering and short paths.`
    },
    controlsSchema: {
      k: {
        type: 'number',
        label: 'Neighborhood k',
        min: 2,
        max: 20,
        default: 4
      },
      p: {
        type: 'number',
        label: 'Rewiring probability',
        min: 0,
        max: 1,
        step: 0.1,
        default: 0.3
      }
    }
  },

  {
    id: 'ba',
    label: 'Barabási-Albert',
    section: '6. Generative Models',
    conditional: false,
    component: BarabasiAlbert,
    contextualizeExplanation: (schema, data) => {
      return `Preferential attachment model. Produces power-law degree distributions.`
    },
    controlsSchema: {
      m: {
        type: 'number',
        label: 'Edges per node',
        min: 1,
        max: 20,
        default: 2
      }
    }
  },

  {
    id: 'model_compare',
    label: 'Model Comparison',
    section: '6. Generative Models',
    conditional: false,
    component: ModelComparison,
    contextualizeExplanation: (schema, data) => {
      return `Compare degree distributions: your graph vs ER, Watts-Strogatz, Barabási-Albert.`
    },
    controlsSchema: {
      metric: {
        type: 'select',
        label: 'Metric',
        options: ['degree', 'clustering', 'avg_path'],
        default: 'degree'
      }
    }
  },

  // 7. Resilience
  {
    id: 'random_fail',
    label: 'Random Failure',
    section: '7. Resilience',
    conditional: false,
    component: RandomFailure,
    contextualizeExplanation: (schema, data) => {
      return `Network resilience: LCC size vs fraction of randomly removed nodes.`
    },
    controlsSchema: {
      steps: {
        type: 'number',
        label: 'Steps',
        min: 5,
        max: 50,
        default: 20
      }
    }
  },

  {
    id: 'targeted',
    label: 'Targeted Attack',
    section: '7. Resilience',
    conditional: false,
    component: TargetedAttack,
    contextualizeExplanation: (schema, data) => {
      return `Targeted attack: LCC size vs removing highest-degree nodes first.`
    },
    controlsSchema: {
      strategy: {
        type: 'select',
        label: 'Strategy',
        options: ['degree', 'betweenness', 'closeness', 'eigenvector'],
        default: 'degree'
      },
      steps: {
        type: 'number',
        label: 'Steps',
        min: 5,
        max: 50,
        default: 20
      }
    }
  },

  // 8. Temporal Analysis
  {
    id: 'timeline',
    label: 'Activity Timeline',
    section: '8. Temporal Analysis',
    conditional: true,
    component: Timeline,
    contextualizeExplanation: (schema, data) => {
      const dateRange = data?.date_range || ['?', '?']
      return `Temporal evolution. Date range: ${dateRange[0]} — ${dateRange[1]}.`
    },
    controlsSchema: {
      granularity: {
        type: 'select',
        label: 'Granularity',
        options: ['day', 'week', 'month', 'year'],
        default: 'month'
      },
      aggregation: {
        type: 'select',
        label: 'Aggregate by',
        options: ['node_count', 'edge_count', 'component_count'],
        default: 'edge_count'
      }
    }
  },

  // 9. Heterogeneous Structure
  {
    id: 'type_dist',
    label: 'Type Distribution',
    section: '9. Heterogeneous Structure',
    conditional: true,
    component: TypeDistribution,
    contextualizeExplanation: (schema, data) => {
      const nodeTypes = (schema.node_types || []).length
      const edgeTypes = (schema.edge_types || []).length
      return `Node types: ${nodeTypes}, Edge types: ${edgeTypes}.`
    },
    controlsSchema: {
      view: {
        type: 'select',
        label: 'View',
        options: ['nodes', 'edges', 'both'],
        default: 'both'
      }
    }
  },

  // 10. Community Detection
  {
    id: 'modularity',
    label: 'Modularity',
    section: '10. Community Detection',
    conditional: false,
    component: Modularity,
    contextualizeExplanation: (schema, data) => {
      return `Community structure quality metric (modularity Q). Ranges from -1 to 1.`
    },
    controlsSchema: {
      algorithm: {
        type: 'select',
        label: 'Algorithm',
        options: ['louvain', 'greedy'],
        default: 'louvain'
      }
    }
  },

  {
    id: 'louvain',
    label: 'Louvain & Leiden',
    section: '10. Community Detection',
    conditional: false,
    component: LouvainLeiden,
    contextualizeExplanation: (schema, data) => {
      const numCommunities = data?.num_communities || '?'
      return `Community detection. Found ${numCommunities} communities.`
    },
    controlsSchema: {
      algorithm: {
        type: 'select',
        label: 'Algorithm',
        options: ['louvain', 'leiden'],
        default: 'louvain'
      },
      resolution: {
        type: 'number',
        label: 'Resolution',
        min: 0.1,
        max: 5,
        step: 0.1,
        default: 1
      }
    }
  },

  {
    id: 'label_prop',
    label: 'Label Propagation',
    section: '10. Community Detection',
    conditional: false,
    component: LabelPropagation,
    contextualizeExplanation: (schema, data) => {
      return `Label propagation: fast community detection via iterative label updates.`
    },
    controlsSchema: {
      maxIterations: {
        type: 'number',
        label: 'Max iterations',
        min: 5,
        max: 100,
        default: 30
      }
    }
  },

  // 11. Link Prediction
  {
    id: 'similarity',
    label: 'Similarity Indices',
    section: '11. Link Prediction',
    conditional: false,
    component: SimilarityIndices,
    contextualizeExplanation: (schema, data) => {
      return `Common neighbor, Jaccard, Adamic-Adar similarity indices for link prediction.`
    },
    controlsSchema: {
      metric: {
        type: 'select',
        label: 'Metric',
        options: ['common_neighbors', 'jaccard', 'adamic_adar', 'preferential_attachment'],
        default: 'common_neighbors'
      },
      topK: {
        type: 'number',
        label: 'Top-K predictions',
        min: 5,
        max: 200,
        default: 50
      }
    }
  },
]

export const SECTIONS = [...new Set(PANEL_SPECS.map(p => p.section))]
