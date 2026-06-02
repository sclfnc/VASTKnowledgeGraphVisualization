"""Effective type labels per node and per edge.

When a graph has `schema.auto_promoted.node` (or `.edge`) set, the dashboard
groups/colors items by that attribute instead of the raw `Node Type` /
`Edge Type`. This module ships the per-item label arrays (SoA, aligned to
the canonical degree-desc ordering of `/nodes/` and the canonical walk
order of `/edges/`).

Future work: a manual override (user picks a different attr to promote)
will pass `node_attr`/`edge_attr` query parameters that override the
schema's `auto_promoted`. Today only the auto path is wired; the cache
key still includes the parameters so the manual case slots in without
backend touches beyond accepting the new args.
"""
from registry import Caches, graph_names, load_graph
from node_index import get_node_order
from schema import compute_schema, effective_type_label


def _compute_node_labels(G, node_order, promo):
    """promo is `{attr, kind}` (or None). Returns a list aligned to node_order.

    Safety net: if no node has the promoted attr (the graph changed since the
    schema was cached, or `auto_promoted` is out of date), returns None instead
    of a list of "Unknown" labels — the frontend then falls back cleanly to the
    raw type.
    """
    if not promo:
        return None
    attr = promo['attr']
    kind = promo['kind']
    labels = [effective_type_label(G.nodes[n].get(attr), kind, attr) for n in node_order]
    if all(l == 'Unknown' for l in labels):
        return None
    return labels


def _compute_edge_labels(G, promo):
    """promo is `{attr, kind}` (or None). Returns a list aligned to the canonical
    edge walk order (the same order used to assign edge_id in /edges/).

    Same safety net as `_compute_node_labels`: returns None if every label would
    be "Unknown".
    """
    if not promo:
        return None
    attr = promo['attr']
    kind = promo['kind']
    is_multi = G.is_multigraph()
    iterator = G.edges(keys=True, data=True) if is_multi else G.edges(data=True)
    labels = []
    for record in iterator:
        data = record[-1]
        labels.append(effective_type_label(data.get(attr), kind, attr))
    if all(l == 'Unknown' for l in labels):
        return None
    return labels


def _resolve_promotion(graph_id: str, node_attr_override, edge_attr_override):
    """Pick the {attr, kind} dict for each scope.

    Override (Phase 7+): if `*_attr_override` is given, validate it exists in
    schema and build a {attr, kind} pair on the fly. Today this is always None
    so behavior collapses to schema.auto_promoted.
    """
    schema = Caches['schema'].get(graph_id)
    if schema is None:
        G = load_graph(graph_id)
        name = graph_names.get(graph_id) or 'Graph'
        schema = compute_schema(G, name=name)
        Caches['schema'][graph_id] = schema

    ap = schema.get('auto_promoted') or {}
    node = ap.get('node')
    edge = ap.get('edge')

    if node_attr_override:
        kind = _lookup_kind(schema, 'node_types_detail', node_attr_override)
        node = {'attr': node_attr_override, 'kind': kind} if kind else None
    if edge_attr_override:
        kind = _lookup_kind(schema, 'edge_types_detail', edge_attr_override)
        edge = {'attr': edge_attr_override, 'kind': kind} if kind else None

    return node, edge


def _lookup_kind(schema, detail_key, attr_name):
    """Find an attribute's kind in `schema.{node|edge}_types_detail` (first match)."""
    for type_entry in schema.get(detail_key, []):
        for a in type_entry.get('attributes', []):
            if a['name'] == attr_name:
                return a['kind']
    return None


def get_effective_types(graph_id: str, node_attr=None, edge_attr=None):
    """Public entry point. Returns `{node: [...] | None, edge: [...] | None,
    promoted: {node: {attr, kind} | None, edge: {attr, kind} | None}}`.

    `node` and `edge` arrays are aligned with /nodes/ degree-desc ordering and
    /edges/ canonical walk respectively. `promoted` echoes the resolved choice
    so the frontend can render captions ("Discriminator: club").
    """
    cache = Caches['effective_types']
    cache_key = (node_attr or '', edge_attr or '')
    sub = cache.setdefault(graph_id, {})
    if cache_key in sub:
        return sub[cache_key]

    G = load_graph(graph_id)
    node_order = get_node_order(graph_id)
    node_promo, edge_promo = _resolve_promotion(graph_id, node_attr, edge_attr)

    result = {
        'node': _compute_node_labels(G, node_order, node_promo),
        'edge': _compute_edge_labels(G, edge_promo),
        'promoted': {'node': node_promo, 'edge': edge_promo},
    }
    sub[cache_key] = result
    return result
