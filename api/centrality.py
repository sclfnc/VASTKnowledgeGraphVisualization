"""Centrality (NetworKit). Eigenvector restricted to LCC; Closeness per-component with Wasserman-Faust."""
import math
import networkx as nx
import networkit as nk

from fastapi import HTTPException
from fastapi.responses import JSONResponse

from schema import node_type
from registry import centrality_cache, centrality_status, graph_registry

TOP_K = 5
SPARSE_TYPE_THRESHOLD = 5  # frontend swaps the violin for a strip-plot below this count
DEGENERATE_FRACTION = 0.01  # variants with largest SCC ≤ this get `degenerate: true`


def centrality_response(graph_id: str, measure: str) -> JSONResponse:
    """Shared response: ready→200, pending/computing→202, cancelled→410, error→500, missing→404."""
    if graph_id not in graph_registry:
        raise HTTPException(status_code=404, detail="Graph ID not found")
    status_map = centrality_status.get(graph_id)
    if not status_map:
        # Graph registered but precompute not yet started — keep frontend polling.
        return JSONResponse(status_code=202, content={"status": "pending"})
    state = status_map.get(measure, 'pending')
    if state == 'ready':
        return JSONResponse(content={"data": centrality_cache[graph_id][measure]})
    if state in ('pending', 'computing'):
        return JSONResponse(status_code=202, content={"status": state})
    if state == 'cancelled':
        raise HTTPException(status_code=410, detail="computation cancelled")
    raise HTTPException(status_code=500, detail=f"{measure} computation failed")


def _build_values(G, score_by_node):
    """{node_id → score} → records + by_type + top_k for the frontend."""
    values = []
    by_type = {}
    for n, score in score_by_node.items():
        record = {
            'id': str(n),
            'type': node_type(G, n),
            'degree': int(G.degree(n)),
            'value': float(score),
        }
        values.append(record)
        by_type.setdefault(record['type'], []).append(record)
    top_k = sorted(values, key=lambda r: r['value'], reverse=True)[:TOP_K]
    return values, by_type, top_k


def _count_per_type(values):
    out = {}
    for r in values:
        out[r['type']] = out.get(r['type'], 0) + 1
    return out


def _nk_with_mapping(G_or_sub):
    """Convert NetworkX (sub)graph → NetworKit + map int → original id."""
    nodes = list(G_or_sub.nodes())
    nk_graph = nk.nxadapter.nx2nk(G_or_sub)
    nk_to_nx = dict(enumerate(nodes))
    return nk_graph, nk_to_nx


def compute_spectral(G):
    """PageRank on the full graph; Eigenvector on the LCC only."""
    nk_full, idx_to_node = _nk_with_mapping(G)
    pr = nk.centrality.PageRank(nk_full, damp=0.85)
    pr.run()
    pr_scores = pr.scores()
    pr_by_node = {idx_to_node[i]: s for i, s in enumerate(pr_scores)}
    pr_values, pr_by_type, pr_top = _build_values(G, pr_by_node)

    # Eigenvector on LCC.
    if G.is_directed():
        cc_iter = nx.weakly_connected_components(G)
    else:
        cc_iter = nx.connected_components(G)
    lcc_nodes = max(cc_iter, key=len)
    sub = G.subgraph(lcc_nodes).copy()
    # NetworKit eigenvector wants undirected + simple — avoid eigenvalue degeneracies.
    sub_simple = nx.Graph(sub)
    nk_sub, sub_idx_to_node = _nk_with_mapping(sub_simple)
    ev = nk.centrality.EigenvectorCentrality(nk_sub)
    ev.run()
    ev_scores = ev.scores()
    ev_by_node = {sub_idx_to_node[i]: s for i, s in enumerate(ev_scores)}
    ev_values, ev_by_type, ev_top = _build_values(sub_simple, ev_by_node)

    return {
        'pagerank': {
            'values': pr_values,
            'by_type': pr_by_type,
            'top_k': pr_top,
            'count_per_type': _count_per_type(pr_values),
        },
        'eigenvector': {
            'values': ev_values,
            'by_type': ev_by_type,
            'top_k': ev_top,
            'count_per_type': _count_per_type(ev_values),
            'excluded_nodes': G.number_of_nodes() - len(ev_values),
        },
    }


def compute_betweenness(G):
    """Exact Betweenness via Brandes' algorithm."""
    nk_graph, idx_to_node = _nk_with_mapping(G)
    bw = nk.centrality.Betweenness(nk_graph, normalized=True)
    bw.run()
    scores = bw.scores()
    by_node = {idx_to_node[i]: s for i, s in enumerate(scores)}
    values, by_type, top_k = _build_values(G, by_node)
    return {
        'values': values,
        'by_type': by_type,
        'top_k': top_k,
        'count_per_type': _count_per_type(values),
    }


def _closeness_variant(G_full, G_variant):
    """Per-component Closeness with W-F normalization (|C|-1)/(|V|-1); singletons → 0."""
    n_full = G_full.number_of_nodes()
    scores_by_node = {}

    components = (
        nx.strongly_connected_components(G_variant)
        if G_variant.is_directed()
        else nx.connected_components(G_variant)
    )

    largest_size = 0

    for comp in components:
        if len(comp) > largest_size:
            largest_size = len(comp)
        if len(comp) == 1:
            (singleton,) = comp
            scores_by_node[singleton] = 0.0
            continue
        sub = G_variant.subgraph(comp)
        sub_simple = nx.DiGraph(sub) if sub.is_directed() else nx.Graph(sub)
        nk_sub, sub_idx_to_node = _nk_with_mapping(sub_simple)
        # normalized=True within the component
        cl = nk.centrality.Closeness(nk_sub, True, nk.centrality.ClosenessVariant.GENERALIZED)
        cl.run()
        wf = (len(comp) - 1) / (n_full - 1) if n_full > 1 else 0.0
        for nk_idx, raw in enumerate(cl.scores()):
            node = sub_idx_to_node[nk_idx]
            val = raw * wf
            if not math.isfinite(val):
                val = 0.0
            scores_by_node[node] = float(val)

    # Defensive: variants are built from G_full, coverage is guaranteed.
    for n in G_full.nodes():
        scores_by_node.setdefault(n, 0.0)

    values, by_type, top_k = _build_values(G_full, scores_by_node)
    payload = {
        'values': values,
        'by_type': by_type,
        'top_k': top_k,
        'count_per_type': _count_per_type(values),
    }
    largest_fraction = largest_size / n_full if n_full else 0.0
    if largest_fraction <= DEGENERATE_FRACTION:
        payload['degenerate'] = True
        payload['largest_component_fraction'] = float(largest_fraction)
    return payload


def compute_closeness(G):
    """Undirected (always); +out/in on directed graphs. Variants flag `degenerate: true` if SCC ≤ 1%."""
    G_und = G.to_undirected() if G.is_directed() else G
    result = {'undirected': _closeness_variant(G, G_und)}
    if G.is_directed():
        result['out'] = _closeness_variant(G, G)
        result['in'] = _closeness_variant(G, G.reverse(copy=False))
    return result
