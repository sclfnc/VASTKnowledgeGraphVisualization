"""Per-(type, attribute) precomputed index for v2 filter pipeline.

Shape (node side):

    {
      "<NodeType>": {
        "<attr>": {                      # 'kind' picked from schema
          "kind": "categorical" | "numeric" | "boolean" | "temporal" | "text",
          # categorical:
          "values": { "<v>": [idx, ...], ... }, "missing": [idx, ...]
          # numeric / temporal:
          "sorted": [[idx, value], ...],            # ascending by value
          "range": [min, max], "missing": [idx, ...]
          # boolean:
          "true": [idx, ...], "false": [idx, ...], "missing": [idx, ...]
          # text (high-cardinality identifier — substring/equals search):
          "values": [[idx, str], ...],    # NOT bucketed; client scans locally
          "distinct": int, "sample": [str, ...], "missing": [idx, ...]
        }, ...
      }, ...
    }

Edge side: identical shape, keyed by edge type.

Node indices are in the canonical degree-desc ordering shared with `/nodes/`
and `/edges/` (see `node_index.get_node_order`). Edge "indices" are
positional in the canonical edge walk of `edge_index._build` — the i-th
edge in the SoA arrays has `edge_id = i`, and that is the index used here.

Built **eagerly** by `get_attribute_index(graph_id)` on first read. Schema
is consulted to pick the right `kind` per attribute (it already infers
categorical / numeric / boolean / temporal via `_classify_attr`).
"""
import math
from collections import defaultdict

from registry import Caches, load_graph
from schema import (
    RESERVED_NODE_ATTRS,
    RESERVED_EDGE_ATTRS,
    STRUCTURAL_NODE_FILTERS,
    STRUCTURAL_EDGE_FILTERS,
    _classify_attr,
    node_type,
    edge_type,
)
from node_index import get_node_order
from timeline import _sniff_strategy


# Skip categorical attrs whose distinct-value ratio exceeds this (free-text /
# identifier names like Song.name, Person.name): a chip multi-select on 8K
# distinct values is broken UX and gonfia il payload.
IDENTIFIER_CARDINALITY_RATIO = 0.5
IDENTIFIER_MIN_DISTINCT = 50
# How many example values to ship alongside a 'text' attr (placeholder hints).
TEXT_SAMPLE_K = 3


def _bucket_categorical(values_by_idx):
    """values_by_idx: list of (idx, value) with non-None value. Returns dict + missing."""
    buckets = defaultdict(list)
    for idx, v in values_by_idx:
        buckets[str(v)].append(idx)
    return {k: buckets[k] for k in sorted(buckets)}


def _bucket_numeric(values_by_idx):
    """Returns sorted list of [idx, value] pairs (ascending by value).

    NaN values are filtered out — they break sort ordering, range comparisons,
    and produce JSON-non-compliant output.
    """
    pairs = []
    for idx, v in values_by_idx:
        if not isinstance(v, (int, float)) or isinstance(v, bool):
            continue
        fv = float(v)
        if math.isnan(fv) or math.isinf(fv):
            continue
        pairs.append([idx, fv])
    pairs.sort(key=lambda p: p[1])
    return pairs


def _bucket_boolean(values_by_idx):
    t, f = [], []
    for idx, v in values_by_idx:
        if v is True:
            t.append(idx)
        elif v is False:
            f.append(idx)
    return t, f


def _bucket_temporal(values_by_idx):
    """Extract year via sniff strategy on this attribute's value list."""
    raw_values = [v for _, v in values_by_idx]
    _, parse_fn = _sniff_strategy(raw_values)
    if parse_fn is None:
        return [], None
    pairs = []
    for idx, v in values_by_idx:
        y = parse_fn(v)
        if y is not None:
            pairs.append([idx, int(y)])
    pairs.sort(key=lambda p: p[1])
    return pairs, parse_fn


def _build_group(items_by_type, idx_lookup):
    """items_by_type: {type_name: [(idx, data_dict), ...]} for nodes or edges.

    Returns the index dict shape documented above.
    """
    out = {}
    excluded = idx_lookup.get('exclude_attrs', set())
    for type_name, items in items_by_type.items():
        if not items:
            out[type_name] = {}
            continue

        # Discover which attrs are present anywhere in this type.
        attrs_present = set()
        for _, data in items:
            attrs_present.update(data.keys())
        attrs_present -= idx_lookup['reserved']
        attrs_present -= excluded   # auto-promoted attr is the new discriminator

        per_attr = {}
        for attr in sorted(attrs_present):
            values_present = [(idx, data[attr]) for idx, data in items
                              if attr in data and data[attr] is not None]
            missing = [idx for idx, data in items
                       if attr not in data or data[attr] is None]
            if not values_present:
                continue
            kind = _classify_attr(attr, [v for _, v in values_present])
            if kind is None:
                continue
            if kind == 'categorical':
                buckets = _bucket_categorical(values_present)
                if not buckets:
                    continue
                distinct = len(buckets)
                # D-i: single distinct value → nothing to filter on.
                if distinct <= 1:
                    continue
                # High-cardinality categoricals are identifiers (Song.name,
                # Person.name): a chip multi-select over thousands of values is
                # broken UX. Emit them as 'text' instead — a substring/equals
                # search widget, with values shipped as an [idx, str] list so the
                # client builds the mask locally (no per-value buckets).
                if (distinct >= IDENTIFIER_MIN_DISTINCT
                        and distinct / len(values_present) > IDENTIFIER_CARDINALITY_RATIO):
                    pairs = [[idx, str(v)] for idx, v in values_present]
                    sample = [v for _, v in pairs[:TEXT_SAMPLE_K]]
                    per_attr[attr] = {'kind': 'text',
                                      'values': pairs,
                                      'distinct': distinct,
                                      'sample': sample,
                                      'missing': missing}
                    continue
                per_attr[attr] = {'kind': 'categorical',
                                  'values': buckets,
                                  'missing': missing}
            elif kind == 'numeric':
                pairs = _bucket_numeric(values_present)
                if not pairs:
                    continue
                # D-i: degenerate range (all values equal, e.g. Karate's weight=1).
                if pairs[0][1] == pairs[-1][1]:
                    continue
                per_attr[attr] = {'kind': 'numeric',
                                  'sorted': pairs,
                                  'range': [pairs[0][1], pairs[-1][1]],
                                  'missing': missing}
            elif kind == 'boolean':
                t, f = _bucket_boolean(values_present)
                if not t and not f:
                    continue
                # D-i: all-true or all-false → nothing to filter on.
                if not t or not f:
                    continue
                per_attr[attr] = {'kind': 'boolean',
                                  'true': t, 'false': f,
                                  'missing': missing}
            elif kind == 'temporal':
                pairs, _fn = _bucket_temporal(values_present)
                if not pairs:
                    continue
                # D-i: degenerate range (all years equal).
                if pairs[0][1] == pairs[-1][1]:
                    continue
                per_attr[attr] = {'kind': 'temporal',
                                  'sorted': pairs,
                                  'range': [pairs[0][1], pairs[-1][1]],
                                  'missing': missing}
        out[type_name] = per_attr
    return out


def _build_node_index(G, node_order, exclude=None):
    """Group nodes by Node Type, attach canonical idx, build per-type dict.

    `exclude` is an optional set of attr names to skip (typically the
    auto-promoted attribute, which is the new discriminator and not filterable).
    """
    idx_of = {n: i for i, n in enumerate(node_order)}
    by_type = defaultdict(list)
    for n, data in G.nodes(data=True):
        t = node_type(G, n)
        by_type[t].append((idx_of[n], data))
    return _build_group(by_type, {
        'reserved': RESERVED_NODE_ATTRS | STRUCTURAL_NODE_FILTERS,
        'exclude_attrs': exclude or set(),
    })


def _build_edge_index(G, exclude=None):
    """Group edges by Edge Type with positional idx == edge_id in /edges/ SoA."""
    is_multi = G.is_multigraph()
    iterator = G.edges(keys=True, data=True) if is_multi else G.edges(data=True)
    by_type = defaultdict(list)
    for edge_id, record in enumerate(iterator):
        if is_multi:
            _u, _v, _key, data = record
        else:
            _u, _v, data = record
        t = edge_type(data)
        by_type[t].append((edge_id, data))
    return _build_group(by_type, {
        'reserved': RESERVED_EDGE_ATTRS | STRUCTURAL_EDGE_FILTERS,
        'exclude_attrs': exclude or set(),
    })


def build(G, node_order):
    """Public entry point. Returns {'node_attrs': {...}, 'edge_attrs': {...}}.

    The auto-promoted attribute is **kept** in the index: it is the source of
    truth for filtering by the promoted (now-effective) type. Display-side
    stringification of the effective type lives separately in
    `effective_types.py`; the two responsibilities are intentionally split so
    the index is one source of truth for all filterable attributes.
    """
    return {
        'node_attrs': _build_node_index(G, node_order),
        'edge_attrs': _build_edge_index(G),
    }


def get_attribute_index(graph_id: str):
    """Return cached attribute index, building on miss."""
    cache = Caches['attribute_index']
    cached = cache.get(graph_id)
    if cached is not None:
        return cached
    G = load_graph(graph_id)
    order = get_node_order(graph_id)
    result = build(G, order)
    cache[graph_id] = result
    return result
