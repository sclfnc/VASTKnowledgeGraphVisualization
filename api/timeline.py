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

from schema import node_type, TEMPORAL_HINTS

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


def _densify(bins_sparse):
    """Fill gaps so scaleBand on the frontend doesn't elide missing years."""
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
        })
    return dense, [lo, hi]


def _to_decade_bins(dense_bins):
    by_dec = {}
    for b in dense_bins:
        dec = (b['year'] // 10) * 10
        slot = by_dec.setdefault(dec, {'year': dec, 'total': 0, 'by_type': {}})
        slot['total'] += b['total']
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


def compute_timeline(G, overrides=None):
    temporal_attrs = sorted({
        k for _, d in G.nodes(data=True)
        for k in d
        if any(h in k.lower() for h in TEMPORAL_HINTS)
    })
    total_nodes = G.number_of_nodes()

    per_attr = {}
    for attr in temporal_attrs:
        values = [d[attr] for _, d in G.nodes(data=True) if attr in d]
        eligible = len(values)
        strategy, fn = _resolve_strategy(attr, values, overrides)

        # Up to 8 distinct raw values, stringified, for the Settings modal preview.
        sample_values = []
        seen = set()
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
                'eligible_nodes': eligible,
                'total_nodes': total_nodes,
                'parse_strategy': strategy,
                'parse_failures': eligible,
                'sample_values': sample_values,
                'bins': [],
                'bins_decade': [],
                'bins_dense': False,
                'year_range': None,
            }
            continue

        bins_raw, valid_count, failures = {}, 0, 0
        for n, d in G.nodes(data=True):
            raw = d.get(attr)
            if raw is None:
                continue
            y = fn(raw)
            if y is None:
                failures += 1
                continue
            valid_count += 1
            nt = node_type(G, n)
            bucket = bins_raw.setdefault(y, {})
            bucket[nt] = bucket.get(nt, 0) + 1

        dense, yrange = _densify(bins_raw)
        decade = _to_decade_bins(dense) if dense else []

        per_attr[attr] = {
            'valid_count': valid_count,
            'eligible_nodes': eligible,
            'total_nodes': total_nodes,
            'parse_strategy': strategy,
            'parse_failures': failures,
            'sample_values': sample_values,
            'bins': dense,
            'bins_decade': decade,
            'bins_dense': True,
            'year_range': yrange,
        }

    return {
        'temporal_attrs': temporal_attrs,
        'per_attr': per_attr,
    }
