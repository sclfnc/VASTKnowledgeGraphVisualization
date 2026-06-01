"""
Connected component analysis for the Connected Components panel.

Returns per-component breakdown: size, composition by node type, internal edge count,
and top-K nodes by degree. WCC for all graphs; SCC additionally for directed graphs.
"""
import networkx as nx

from schema import node_type

# How many top-degree nodes to ship per component for the drill-down.
TOP_K_PER_COMPONENT = 5

# Stop reporting per-component detail past this rank — payload control on
# pathological inputs with thousands of singletons. The aggregate count is
# still accurate; only the per-component records are truncated.
MAX_COMPONENT_DETAILS = 200


def _component_record(G, nodes, comp_id):
    """Build the per-component payload for a single component."""
    sub = G.subgraph(nodes)
    by_type = {}
    for n in nodes:
        t = node_type(G, n)
        by_type[t] = by_type.get(t, 0) + 1

    # Degree is computed on the subgraph so it reflects internal connectivity,
    # not the node's degree in the whole graph.
    deg_iter = sub.degree()
    top = sorted(deg_iter, key=lambda x: x[1], reverse=True)[:TOP_K_PER_COMPONENT]
    top_degree = [{'id': str(nid), 'degree': int(d)} for nid, d in top]

    return {
        'id': comp_id,
        'size': len(nodes),
        'by_type': by_type,
        'edges_internal': sub.number_of_edges(),
        'top_degree': top_degree,
    }


def _summarize(G, components):
    """components is an iterable of node-set; returns the panel-ready summary."""
    comps_sorted = sorted(components, key=len, reverse=True)
    total_nodes = G.number_of_nodes()
    lcc_size = len(comps_sorted[0]) if comps_sorted else 0

    records = [
        _component_record(G, nodes, i)
        for i, nodes in enumerate(comps_sorted[:MAX_COMPONENT_DETAILS])
    ]

    return {
        'count': len(comps_sorted),
        'lcc_size': lcc_size,
        'lcc_fraction': (lcc_size / total_nodes) if total_nodes else 0,
        'singletons': sum(1 for nodes in comps_sorted if len(nodes) == 1),
        'truncated': len(comps_sorted) > MAX_COMPONENT_DETAILS,
        'components': records,
    }


def compute_components(G):
    """Connectivity breakdown: weakly connected components always, plus strongly connected
    components on directed graphs (per-component records + aggregate counts)."""
    wcc = _summarize(G, nx.weakly_connected_components(G) if G.is_directed() else nx.connected_components(G))
    result = {'wcc': wcc, 'directed': G.is_directed()}
    if G.is_directed():
        result['scc'] = _summarize(G, nx.strongly_connected_components(G))
    return result
