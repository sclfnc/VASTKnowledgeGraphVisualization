"""
Temporal activity analysis for the Activity Timeline panel.

Year extraction strategy: per-attribute sniff on the first 100 non-null
values to pick a single strategy, then applied to all values. Strategies
(in priority order):
  - 'int_year':   raw int/float in [1000, 2200]                  → int(v)
  - 'unix_ts':    int/float > 1e9                                → datetime.utcfromtimestamp(v).year
  - 'iso_date':   str parseable by datetime.fromisoformat        → .year
  - 'regex':      str containing \\b(1\\d{3}|2[01]\\d{2})\\b     → captured group
  - 'none':       no strategy fits → attribute reported with valid_count=0

User overrides (per-attribute) can force a built-in strategy or supply a
custom regex with a single year-capture group.
"""
import re
from datetime import datetime, timezone

from schema import node_type, edge_type, TEMPORAL_HINTS
from node_index import get_node_order
from edge_index import get_edge_index_map

_SNIFF_SIZE = 100
_YEAR_REGEX = re.compile(r'\b(1\d{3}|2[01]\d{2})\b')


def _try_int_year(v):
    if isinstance(v, bool):
        return None
    if isinstance(v, (int, float)):
        iv = int(v)
        if 1000 <= iv <= 2200:
            return iv
    return None


def _try_unix_ts(v):
    if isinstance(v, bool):
        return None
    if isinstance(v, (int, float)) and v > 1e9:
        try:
            return datetime.fromtimestamp(float(v), tz=timezone.utc).year
        except (ValueError, OSError, OverflowError):
            return None
    return None


def _try_iso(v):
    if not isinstance(v, str):
        return None
    try:
        return datetime.fromisoformat(v.replace('Z', '+00:00')).year
    except ValueError:
        return None


def _try_regex(v):
    if not isinstance(v, str):
        return None
    m = _YEAR_REGEX.search(v)
    return int(m.group(1)) if m else None


_STRATEGIES = [
    ('int_year', _try_int_year),
    ('unix_ts',  _try_unix_ts),
    ('iso_date', _try_iso),
    ('regex',    _try_regex),
]


def _sniff_strategy(values):
    """Pick the strategy with the highest hit rate on the sniff sample."""
    sample = [v for v in values if v is not None][:_SNIFF_SIZE]
    if not sample:
        return 'none', None
    best_name, best_fn, best_hits = 'none', None, 0
    for name, fn in _STRATEGIES:
        hits = sum(1 for v in sample if fn(v) is not None)
        if hits > best_hits:
            best_name, best_fn, best_hits = name, fn, hits
    if best_hits == 0:
        return 'none', None
    return best_name, best_fn


def _densify(bins_sparse, idx_sparse):
    """Fill gaps so scaleBand on the frontend doesn't elide missing years.

    `idx_sparse` maps year → list of canonical SoA indices for the records in
    that year; shipped as `idx` so the frontend can mask-intersect each bin.
    """
    if not bins_sparse:
        return [], None
    years = sorted(bins_sparse.keys())
    lo, hi = years[0], years[-1]
    dense = []
    for y in range(lo, hi + 1):
        bucket = bins_sparse.get(y, {})
        dense.append({
            'year': y,
            'total': sum(bucket.values()),
            'by_type': bucket,
            'idx': idx_sparse.get(y, []),
        })
    return dense, [lo, hi]


def _to_decade_bins(dense_bins):
    by_dec = {}
    for b in dense_bins:
        dec = (b['year'] // 10) * 10
        slot = by_dec.setdefault(dec, {'year': dec, 'total': 0, 'by_type': {}, 'idx': []})
        slot['total'] += b['total']
        slot['idx'].extend(b['idx'])
        for t, c in b['by_type'].items():
            slot['by_type'][t] = slot['by_type'].get(t, 0) + c
    return [by_dec[d] for d in sorted(by_dec)]


def _custom_regex_strategy(pattern):
    try:
        rx = re.compile(pattern)
    except re.error:
        return None

    def fn(v):
        if not isinstance(v, str):
            return None
        m = rx.search(v)
        if not m:
            return None
        try:
            return int(m.group(1))
        except (IndexError, ValueError):
            return None
    return fn


def _resolve_strategy(attr, values, overrides):
    """
    Pick the parse strategy for `attr`. If `overrides[attr]` is set:
      - {'strategy': 'regex', 'pattern': '...'} → custom regex
      - {'strategy': '<builtin>'}              → forced built-in strategy
    Else: auto-sniff.
    """
    o = (overrides or {}).get(attr)
    if o:
        if o.get('strategy') == 'regex' and o.get('pattern'):
            fn = _custom_regex_strategy(o['pattern'])
            if fn is not None:
                return f"regex_custom:{o['pattern']}", fn
        forced = o.get('strategy')
        for name, fn in _STRATEGIES:
            if name == forced:
                return name, fn
    return _sniff_strategy(values)


def _per_attr_summary(records, attr_iter, get_data, get_breakdown_key, get_index, overrides):
    """Build `per_attr` map for one scope (nodes or edges).

    - `records`: total record count for the scope (denominator in coverage).
    - `attr_iter`: discovered temporal attribute names for the scope.
    - `get_data(record) → dict-like`: returns the attribute container.
    - `get_breakdown_key(record) → str`: returns the by-type bucket key
      (Node Type for nodes, Edge Type for edges).
    - `get_index(record) → int | None`: the canonical SoA index of the record
      (node_order position for nodes, edge_id for edges). Attached per bin so the
      frontend can intersect each bin with activeNodeMask/activeEdgeMask
      (mask-only contract) instead of trusting raw payload counts.
    """
    per_attr = {}
    for attr in attr_iter:
        values = [get_data(r)[attr] for r in records if attr in get_data(r)]
        eligible = len(values)
        strategy, fn = _resolve_strategy(attr, values, overrides)

        # Up to 8 distinct raw values for the Settings modal preview.
        sample_values, seen = [], set()
        for v in values:
            s = str(v)
            if s not in seen:
                seen.add(s)
                sample_values.append(s)
                if len(sample_values) >= 8:
                    break

        if fn is None:
            per_attr[attr] = {
                'valid_count': 0,
                'eligible_records': eligible,
                'total_records': len(records),
                'parse_strategy': strategy,
                'parse_failures': eligible,
                'sample_values': sample_values,
                'bins': [],
                'bins_decade': [],
                'bins_dense': False,
                'year_range': None,
            }
            continue

        bins_raw, bins_idx, valid_count, failures = {}, {}, 0, 0
        for r in records:
            d = get_data(r)
            raw = d.get(attr)
            if raw is None:
                continue
            y = fn(raw)
            if y is None:
                failures += 1
                continue
            valid_count += 1
            bkey = get_breakdown_key(r)
            bucket = bins_raw.setdefault(y, {})
            bucket[bkey] = bucket.get(bkey, 0) + 1
            idx = get_index(r)
            if idx is not None:
                bins_idx.setdefault(y, []).append(idx)

        dense, yrange = _densify(bins_raw, bins_idx)
        decade = _to_decade_bins(dense) if dense else []

        per_attr[attr] = {
            'valid_count': valid_count,
            'eligible_records': eligible,
            'total_records': len(records),
            'parse_strategy': strategy,
            'parse_failures': failures,
            'sample_values': sample_values,
            'bins': dense,
            'bins_decade': decade,
            'bins_dense': True,
            'year_range': yrange,
        }
    return per_attr


def compute_timeline(graph_id, G, overrides=None):
    # Canonical SoA index maps so per-bin `idx` lists align with /nodes/ and
    # /edges/. Nodes: position in node_order (degree-desc) — same ordering as
    # /nodes/. Edges: edge_id = position in the canonical edge walk (matches
    # edge_index._build, which uses the same G.edges(keys=True) / G.edges() walk).
    node_order = get_node_order(graph_id)
    node_to_idx = {n: i for i, n in enumerate(node_order)}

    # Node-scope: attrs sniffed across all node-data dicts.
    node_records = list(G.nodes(data=True))
    node_attrs = sorted({
        k for _, d in node_records for k in d
        if any(h in k.lower() for h in TEMPORAL_HINTS)
    })
    per_attr_node = _per_attr_summary(
        node_records,
        node_attrs,
        get_data=lambda r: r[1],
        get_breakdown_key=lambda r: node_type(G, r[0]),
        get_index=lambda r: node_to_idx.get(r[0]),
        overrides=overrides,
    )

    # Edge-scope: attrs sniffed across edge-data dicts. The walk order matches
    # edge_index._build, so the enumeration index IS the canonical edge_id.
    if G.is_multigraph():
        edge_records = [(u, v, d) for u, v, _k, d in G.edges(data=True, keys=True)]
    else:
        edge_records = [(u, v, d) for u, v, d in G.edges(data=True)]
    edge_to_idx = {id(r): i for i, r in enumerate(edge_records)}
    edge_attrs = sorted({
        k for *_, d in edge_records for k in d
        if any(h in k.lower() for h in TEMPORAL_HINTS)
    })
    per_attr_edge = _per_attr_summary(
        edge_records,
        edge_attrs,
        get_data=lambda r: r[2],
        get_breakdown_key=lambda r: edge_type(r[2]),
        get_index=lambda r: edge_to_idx.get(id(r)),
        overrides=overrides,
    )

    return {
        'temporal_attrs_node': node_attrs,
        'temporal_attrs_edge': edge_attrs,
        'per_attr_node': per_attr_node,
        'per_attr_edge': per_attr_edge,
    }
