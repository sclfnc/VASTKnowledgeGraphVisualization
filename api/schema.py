"""Schema extraction + built-in dataset normalization (inject Node Type / Edge Type at load)."""
import csv
import gzip
import os
from collections import Counter, defaultdict
from datetime import datetime, timezone

import networkx as nx

# Directory that holds raw dataset files shipped with the project.
_DATA_DIR = os.path.join(os.path.dirname(__file__), "graph_storage", "builtin_data")


def _load_email_eu_core():
    """Email-Eu-Core directed graph (SNAP, BSD): 1,005 nodes, 25,571 edges.
    Source : https://snap.stanford.edu/data/email-Eu-core.html
    Licence: BSD  (https://snap.stanford.edu/snap/license.html)

    Each node gets a `department` attr (0-41) and a `Node Type` of "Dept N"
    so the rest of the pipeline can group/colour by department like any type.

    Source files are fetched from SNAP on first use (see builtin_download).
    """
    from builtin_download import ensure_dataset_files
    ensure_dataset_files("email_eu_core")
    edges_file = os.path.join(_DATA_DIR, "email-eu-core.txt.gz")
    dept_file  = os.path.join(_DATA_DIR, "email-eu-core-dept.txt.gz")

    dept = {}
    with gzip.open(dept_file, "rt") as f:
        for line in f:
            line = line.strip()
            if not line or line.startswith("#"):
                continue
            node_id, dept_id = line.split()
            dept[int(node_id)] = int(dept_id)

    G = nx.DiGraph()
    with gzip.open(edges_file, "rt") as f:
        for line in f:
            line = line.strip()
            if not line or line.startswith("#"):
                continue
            src, dst = map(int, line.split())
            G.add_edge(src, dst)

    for n in G.nodes():
        d = dept.get(n, -1)
        G.nodes[n]["department"] = d
        G.nodes[n]["Node Type"] = f"Dept {d}" if d >= 0 else "Unknown"

    for *_, edata in G.edges(data=True):
        edata["Edge Type"] = "Email"

    return G


def _load_movielens_small():
    """MovieLens Latest Small (GroupLens, CC BY 4.0): bipartite User→Movie graph.
    Source : https://grouplens.org/datasets/movielens/latest/
    Licence: CC BY 4.0  (https://files.grouplens.org/datasets/movielens/ml-latest-small-README.html)

    610 users + 9,742 movies, 100,836 `Rated` edges. Movies carry `release_year`
    + `genres`; edges carry `weight` (the 0.5-5.0 rating) and `rating_date`.
    The heaviest built-in — used to stress-test centrality at scale.

    Source files are fetched from GroupLens on first use (see builtin_download).
    """
    from builtin_download import ensure_dataset_files
    ensure_dataset_files("movielens_small")
    ratings_file = os.path.join(_DATA_DIR, "ml-ratings.csv")
    movies_file  = os.path.join(_DATA_DIR, "ml-movies.csv")

    # Build movie metadata: movieId -> {release_year, genres}
    movies = {}
    with open(movies_file, newline="", encoding="utf-8") as f:
        for row in csv.DictReader(f):
            mid = int(row["movieId"])
            title = row["title"]
            # Extract year from "Title (YYYY)" pattern.
            year = None
            if title.endswith(")") and "(" in title:
                candidate = title[title.rfind("(") + 1:-1]
                if candidate.isdigit():
                    year = int(candidate)
            movies[mid] = {
                "release_year": year,
                "genres": row["genres"].replace("|", ", "),
            }

    G = nx.DiGraph()

    with open(ratings_file, newline="", encoding="utf-8") as f:
        for row in csv.DictReader(f):
            uid  = f"u{row['userId']}"
            mid  = int(row["movieId"])
            mkey = f"m{mid}"
            ts   = int(row["timestamp"])
            date_str = datetime.fromtimestamp(ts, tz=timezone.utc).strftime("%Y-%m-%d")

            if not G.has_node(uid):
                G.add_node(uid, **{"Node Type": "User"})
            if not G.has_node(mkey):
                meta = movies.get(mid, {})
                G.add_node(mkey,
                           release_year=meta.get("release_year"),
                           genres=meta.get("genres", ""),
                           **{"Node Type": "Movie"})

            G.add_edge(uid, mkey,
                       weight=float(row["rating"]),
                       rating_date=date_str,
                       **{"Edge Type": "Rated"})

    return G

TEMPORAL_HINTS = ('date', 'year', 'time', 'timestamp')
RESERVED_NODE_ATTRS = {'Node Type'}
RESERVED_EDGE_ATTRS = {'Edge Type'}

# Attributes already exposed as top-level structural filters in the frontend
# (`filters.degree`, `filters.weight`). They stay visible in schema/attr
# schema views, but the filter index excludes them so the UI doesn't render
# a duplicate per-type slider. Keep in sync with `AttributeFilters.vue`
# Degree filtering / Weight filtering sections.
STRUCTURAL_NODE_FILTERS = set()         # `degree` is computed, not a node attr
STRUCTURAL_EDGE_FILTERS = {'weight'}

# Caps the categorical filter payload — beyond this we ship a truncated list.
MAX_CATEGORICAL_VALUES = 50

# Top-K categorical values surfaced in the per-type attribute summary.
TYPE_DETAIL_TOP_K = 3


# The single reserved key per scope; the helpers below read it so the literal
# lives in exactly one place.
_NODE_TYPE_KEY = next(iter(RESERVED_NODE_ATTRS))   # 'Node Type'
_EDGE_TYPE_KEY = next(iter(RESERVED_EDGE_ATTRS))   # 'Edge Type'
UNKNOWN_TYPE = 'Unknown'


def node_type(G, n):
    """Single source of truth for the `Node Type` attribute lookup."""
    return G.nodes[n].get(_NODE_TYPE_KEY, UNKNOWN_TYPE)


def edge_type(data):
    """Single source of truth for the `Edge Type` lookup. Takes the edge's data
    dict (works for every walk shape: `G.edges(data=True)`, multigraph keys
    stripped, or a reverse-mapped attr dict)."""
    return data.get(_EDGE_TYPE_KEY, UNKNOWN_TYPE)


def json_scalar(v):
    """JSON-safe coercion for arbitrary attr values (numpy scalars, sets,
    datetimes, nested containers). Shared by the inspector payloads."""
    if v is None or isinstance(v, (str, int, float, bool)):
        return v
    if isinstance(v, (list, tuple)):
        return [json_scalar(x) for x in v]
    if isinstance(v, (set, frozenset)):
        return sorted(json_scalar(x) for x in v)
    if isinstance(v, dict):
        return {str(k): json_scalar(val) for k, val in v.items()}
    try:
        return v.item()
    except AttributeError:
        return str(v)


def percentile(sorted_data, p):
    """Linear-interpolation percentile over a pre-sorted sequence."""
    idx = (len(sorted_data) - 1) * p / 100
    lo, hi = int(idx), min(int(idx) + 1, len(sorted_data) - 1)
    return sorted_data[lo] + (sorted_data[hi] - sorted_data[lo]) * (idx - lo)


def _infer_attr_kind(values):
    """Coarse attribute kind from a value sample: 'boolean' | 'numeric' | 'categorical'; None if all-null."""
    sample = [v for v in values if v is not None]
    if not sample:
        return None
    if all(isinstance(v, bool) for v in sample):
        return 'boolean'
    if all(isinstance(v, (int, float)) and not isinstance(v, bool) for v in sample):
        return 'numeric'
    return 'categorical'


def _classify_attr(name, values):
    """Like _infer_attr_kind but promotes to 'temporal' when the name hints at time."""
    kind = _infer_attr_kind(values)
    if kind is None:
        return None
    if kind in ('categorical', 'numeric') and any(h in name.lower() for h in TEMPORAL_HINTS):
        return 'temporal'
    return kind


def _summarize_attr(values, kind):
    """Compact per-kind summary: numeric range, boolean true/false counts, categorical top-K + distinct, temporal min/max."""
    sample = [v for v in values if v is not None]
    if not sample:
        return None
    if kind == 'numeric':
        nums = [v for v in sample if isinstance(v, (int, float)) and not isinstance(v, bool)]
        return {'min': min(nums), 'max': max(nums)} if nums else None
    if kind == 'boolean':
        true_count = sum(1 for v in sample if v is True)
        return {'true': true_count, 'false': len(sample) - true_count}
    if kind == 'categorical':
        c = Counter(str(v) for v in sample)
        return {
            'top': [{'value': v, 'count': n} for v, n in c.most_common(TYPE_DETAIL_TOP_K)],
            'distinct': len(c),
        }
    if kind == 'temporal':
        nums = [v for v in sample if isinstance(v, (int, float)) and not isinstance(v, bool)]
        if nums:
            return {'min': min(nums), 'max': max(nums)}
        # ISO-like strings sort correctly lexicographically
        strs = sorted(str(v) for v in sample)
        return {'min': strs[0], 'max': strs[-1]}
    return None


def _attributes_for_group(items, reserved):
    """`items` is a list of attribute dicts (from G.nodes(data=True) or G.edges(data=True))."""
    if not items:
        return []
    attrs_present = {k for d in items for k in d if k not in reserved}
    out = []
    for attr in sorted(attrs_present):
        values = [d[attr] for d in items if attr in d]
        kind = _classify_attr(attr, values)
        if kind is None:
            continue
        out.append({
            'name': attr,
            'kind': kind,
            'count': len(values),
            'coverage': len(values) / len(items),
            'summary': _summarize_attr(values, kind),
        })
    return out


def effective_type_label(value, attr_kind, attr_name):
    """Stringify a promoted attribute's value to use as the effective type label.

    Categorical: raw value (already a string the user can read).
    Numeric / boolean: prefix with `<attr> = <value>` so the dashboard doesn't
    show bare `0` / `1` / `True` as type labels.
    """
    if value is None:
        return 'Unknown'
    if attr_kind == 'categorical':
        return str(value)
    return f"{attr_name} = {value}"


def _numeric_is_binary(values_iter, attr_name):
    """Stream-count distinct values of `attr_name`; bail at 3.

    NaN values are skipped: `nan != nan` would let multiple NaN instances
    appear as distinct elements in the set and produce a false-positive
    binary classification.
    """
    import math
    seen = set()
    for d in values_iter:
        v = d.get(attr_name)
        if v is None:
            continue
        if isinstance(v, float) and (math.isnan(v) or math.isinf(v)):
            continue
        seen.add(v)
        if len(seen) > 2:
            return False
    return len(seen) == 2


def _eligible_for_promotion(a, total_count, values_iter_factory):
    """An attr can be auto-promoted iff it has full coverage and is plausibly
    a type discriminator:
      - categorical: distinct ≥ 2 (any low-/mid-cardinality is fine).
      - boolean: both True and False values present (distinct = 2 by nature).
      - numeric: distinct = 2 — captures the bipartite-indicator case
        (Davis' `bipartite ∈ {0,1}`). Higher-cardinality numeric attrs
        (weights, scores, frequencies) are not types — refuse.

    `values_iter_factory()` yields the data dicts of the scope (nodes or
    edges) — used only by the numeric branch to count distinct values.
    """
    if a['count'] != total_count or not a['summary']:
        return False
    if a['kind'] == 'categorical':
        return a['summary'].get('distinct', 0) >= 2
    if a['kind'] == 'boolean':
        return a['summary'].get('true', 0) > 0 and a['summary'].get('false', 0) > 0
    if a['kind'] == 'numeric':
        rng = a['summary']
        if rng.get('min') is None or rng.get('max') is None or rng['min'] == rng['max']:
            return False
        return _numeric_is_binary(values_iter_factory(), a['name'])
    return False


def _compute_auto_promotion(types_detail, total_count, values_iter_factory):
    """Auto-promote rule: if a scope has a single global type AND exactly one
    eligible discriminator attribute, return `{attr, kind}`; else None. The
    frontend then treats that attr as the effective type (Karate's club, etc.).
    """
    if len(types_detail) != 1:
        return None
    attrs = types_detail[0].get('attributes', [])
    eligible = [a for a in attrs if _eligible_for_promotion(a, total_count, values_iter_factory)]
    if len(eligible) != 1:
        return None
    pick = eligible[0]
    return {'attr': pick['name'], 'kind': pick['kind']}


def compute_schema(G, name='Graph'):
    """Lightweight graph schema: node/edge types + per-type attribute detail, structural flags
    (directed/weighted/bipartite/self-loops/acyclic), degree/weight ranges, temporal attrs by
    scope, and the auto-promotion pick. Cached per graph_id."""
    nodes_data = list(G.nodes(data=True))
    edge_data = [d for _, _, d in G.edges(data=True)]

    node_attrs = {k for _, d in nodes_data for k in d}
    node_types = sorted({d.get('Node Type', 'Unknown') for _, d in nodes_data})
    edge_types = sorted({d.get('Edge Type', 'Unknown') for d in edge_data})

    # weighted requires ≥ 2 distinct weight values. NaN/inf filtered out:
    # they break min/max and produce JSON-non-compliant output.
    import math
    weights = [d['weight'] for d in edge_data
               if 'weight' in d and isinstance(d['weight'], (int, float))
               and not isinstance(d['weight'], bool)
               and not (math.isnan(d['weight']) or math.isinf(d['weight']))]
    distinct_weights = set(weights)
    weighted = len(distinct_weights) > 1
    weight_range = [min(weights), max(weights)] if weighted else None

    edge_attrs = {k for d in edge_data for k in d}
    # Temporal attrs split by scope (name-hint heuristic) so the dashboard can
    # exclude the node/edge timeline panel when its scope has none.
    temporal_attrs_node = sorted({a for a in node_attrs if any(h in a.lower() for h in TEMPORAL_HINTS)})
    temporal_attrs_edge = sorted({a for a in (edge_attrs - RESERVED_EDGE_ATTRS)
                                  if any(h in a.lower() for h in TEMPORAL_HINTS)})
    temporal_attrs = temporal_attrs_node  # backward-compat alias (node scope)

    # Total degree only; frontend splits in/out for directed graphs.
    degrees = [d for _, d in G.degree()]
    degree_range = [min(degrees), max(degrees)] if degrees else [0, 0]

    # Per-attribute kind inference drives dynamic filters.
    attributes = []
    for attr in sorted(node_attrs - RESERVED_NODE_ATTRS):
        values = [d[attr] for _, d in nodes_data if attr in d]
        kind = _infer_attr_kind(values)
        if kind is None:
            continue
        entry = {'name': attr, 'kind': kind}
        if kind == 'numeric':
            nums = [v for v in values if isinstance(v, (int, float)) and not isinstance(v, bool)]
            if nums:
                entry['range'] = [min(nums), max(nums)]
        elif kind == 'categorical':
            cats = sorted({str(v) for v in values})
            if len(cats) <= MAX_CATEGORICAL_VALUES:
                entry['values'] = cats
            else:
                entry['values'] = cats[:MAX_CATEGORICAL_VALUES]
                entry['truncated'] = True
        attributes.append(entry)

    self_loops = nx.number_of_selfloops(G)
    acyclic = nx.is_directed_acyclic_graph(G) if G.is_directed() else None
    try:
        bipartite = nx.is_bipartite(G)
    except nx.NetworkXError:
        bipartite = False

    # Per-type detail drives GraphContextBar + node_attrs/edge_attrs panels.
    nodes_by_type = defaultdict(list)
    for _, d in nodes_data:
        nodes_by_type[d.get('Node Type', 'Unknown')].append(d)
    node_types_detail = [
        {'name': t, 'count': len(nodes_by_type[t]),
         'attributes': _attributes_for_group(nodes_by_type[t], RESERVED_NODE_ATTRS)}
        for t in node_types
    ]

    edges_by_type = defaultdict(list)
    for d in edge_data:
        edges_by_type[d.get('Edge Type', 'Unknown')].append(d)
    edge_types_detail = [
        {'name': t, 'count': len(edges_by_type[t]),
         'attributes': _attributes_for_group(edges_by_type[t], RESERVED_EDGE_ATTRS)}
        for t in edge_types
    ]

    auto_promoted = {
        'node': _compute_auto_promotion(
            node_types_detail, len(nodes_data),
            lambda: (d for _, d in nodes_data),
        ),
        'edge': _compute_auto_promotion(
            edge_types_detail, len(edge_data),
            lambda: iter(edge_data),
        ),
    }

    return {
        'name': name,
        'nodes': G.number_of_nodes(),
        'edges': G.number_of_edges(),
        'directed': G.is_directed(),
        'multigraph': G.is_multigraph(),
        'weighted': weighted,
        'bipartite': bipartite,
        'node_types': node_types,
        'edge_types': edge_types,
        'node_types_detail': node_types_detail,
        'edge_types_detail': edge_types_detail,
        'temporal_attrs': temporal_attrs,
        'temporal_attrs_node': temporal_attrs_node,
        'temporal_attrs_edge': temporal_attrs_edge,
        'self_loops': self_loops,
        'acyclic': acyclic,
        'degree_range': degree_range,
        'weight_range': weight_range,
        'attributes': attributes,
        'auto_promoted': auto_promoted,
        'warnings': [],
    }


# Built-in dataset registry — maps name to (loader_fn, description).
BUILTIN_DATASETS = {
    "karate":          (nx.karate_club_graph,          "Zachary's Karate Club"),
    "les_miserables":  (nx.les_miserables_graph,       "Les Misérables characters"),
    "florentine":      (nx.florentine_families_graph,  "Florentine families"),
    "davis":           (nx.davis_southern_women_graph, "Davis Southern Women"),
    "email_eu_core":   (_load_email_eu_core,           "Email Eu-Core"),
    "movielens_small": (_load_movielens_small,         "MovieLens Small"),
}


def load_node_link(data):
    """Accept both legacy 'links' (NetworkX <3.4) and new 'edges' (≥3.4) keys."""
    if not isinstance(data, dict):
        raise ValueError("payload must be a JSON object, not " + type(data).__name__)
    if 'links' in data:
        return nx.node_link_graph(data, edges='links')
    if 'edges' in data:
        return nx.node_link_graph(data, edges='edges')
    raise ValueError("payload has neither 'links' nor 'edges' field")
