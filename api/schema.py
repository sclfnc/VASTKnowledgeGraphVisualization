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
    """
    Email-Eu-Core directed graph (SNAP / Stanford).
    Source : https://snap.stanford.edu/data/email-Eu-core.html
    Licence: BSD  (https://snap.stanford.edu/snap/license.html)

    1,005 nodes (university researchers), 25,571 directed edges.
    Node attribute  : department (42 research departments, integer 0-41).
    Edge attribute  : none beyond direction.
    Gap coverage    : directed graph, multi-node-type (42 departments).
    """
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
    """
    MovieLens Latest Small bipartite graph (GroupLens / University of Minnesota).
    Source : https://grouplens.org/datasets/movielens/latest/
    Licence: CC BY 4.0  (https://files.grouplens.org/datasets/movielens/ml-latest-small-README.html)

    610 User nodes + 9,742 Movie nodes = 10,352 nodes total.
    100,836 directed edges (User --[Rated]--> Movie).
    Node attributes : Movie nodes carry `release_year` (int) and `genres` (str).
    Edge attributes : `weight` = rating (0.5–5.0), `timestamp` (ISO-8601 date string).
    Gap coverage    : weighted edges, temporal attribute on nodes (release_year),
                      bipartite graph, large-scale centrality stress test.
    """
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

# Caps the categorical filter payload — beyond this we ship a truncated list.
MAX_CATEGORICAL_VALUES = 50

# Top-K categorical values surfaced in the per-type attribute summary.
TYPE_DETAIL_TOP_K = 3


def node_type(G, n):
    """Single source of truth for the `Node Type` attribute lookup."""
    return G.nodes[n].get('Node Type', 'Unknown')


def percentile(sorted_data, p):
    """Linear-interpolation percentile over a pre-sorted sequence."""
    idx = (len(sorted_data) - 1) * p / 100
    lo, hi = int(idx), min(int(idx) + 1, len(sorted_data) - 1)
    return sorted_data[lo] + (sorted_data[hi] - sorted_data[lo]) * (idx - lo)


def _infer_attr_kind(values):
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


def compute_schema(G, name='Graph'):
    nodes_data = list(G.nodes(data=True))
    edge_data = [d for _, _, d in G.edges(data=True)]

    node_attrs = {k for _, d in nodes_data for k in d}
    node_types = sorted({d.get('Node Type', 'Unknown') for _, d in nodes_data})
    edge_types = sorted({d.get('Edge Type', 'Unknown') for d in edge_data})

    # weighted requires ≥ 2 distinct weight values.
    weights = [d['weight'] for d in edge_data if 'weight' in d]
    distinct_weights = set(weights)
    weighted = len(distinct_weights) > 1
    weight_range = [min(weights), max(weights)] if weighted else None

    temporal_attrs = sorted({a for a in node_attrs if any(h in a.lower() for h in TEMPORAL_HINTS)})

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
        'self_loops': self_loops,
        'acyclic': acyclic,
        'degree_range': degree_range,
        'weight_range': weight_range,
        'attributes': attributes,
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

# Inject Node/Edge Type so compute_schema treats built-ins uniformly.
# 'from': read attribute (optional 'map' remap); 'const': fixed string.
BUILTIN_TYPE_NORMALIZATION = {
    "karate":          {'node': {'from': 'club'},
                        'edge': {'const': 'Friendship'}},
    "les_miserables":  {'node': {'const': 'Character'},
                        'edge': {'const': 'CoAppearance'}},
    "florentine":      {'node': {'const': 'Family'},
                        'edge': {'const': 'Marriage'}},
    "davis":           {'node': {'from': 'bipartite', 'map': {0: 'Woman', 1: 'Event'}},
                        'edge': {'const': 'Attended'}},
    # email_eu_core and movielens_small inject Node/Edge Type directly in their
    # loaders (_load_email_eu_core / _load_movielens_small) — no entry needed here.
}


def normalize_builtin_types(name, G):
    spec = BUILTIN_TYPE_NORMALIZATION.get(name)
    if not spec:
        return
    nspec = spec.get('node')
    if nspec:
        for _, d in G.nodes(data=True):
            if 'const' in nspec:
                d['Node Type'] = nspec['const']
            else:
                v = d.get(nspec['from'])
                d['Node Type'] = nspec.get('map', {}).get(v, str(v))
    espec = spec.get('edge')
    if espec:
        for *_, d in G.edges(data=True):
            if 'const' in espec:
                d['Edge Type'] = espec['const']
            else:
                v = d.get(espec['from'])
                d['Edge Type'] = espec.get('map', {}).get(v, str(v))


def load_node_link(data):
    """Accept both legacy 'links' (NetworkX <3.4) and new 'edges' (≥3.4) keys."""
    if 'links' in data:
        return nx.node_link_graph(data, edges='links')
    if 'edges' in data:
        return nx.node_link_graph(data, edges='edges')
    raise ValueError("payload has neither 'links' nor 'edges' field")
