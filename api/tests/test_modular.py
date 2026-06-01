"""Tests for the modular backend (this project's own 23 endpoints).

Separate from the upstream suite (test_api.py / test_cors.py), which covers the
legacy compatibility layer. Level: contract + key invariants — status codes,
expected keys, and the cross-endpoint guarantees the frontend relies on:

  - canonical orderings: /nodes/ is degree-desc; /edges/ source[i]/target[i]
    index into /nodes/; edge_id == position in /edges/.
  - mask-only model: payloads describe the FULL graph (no filter param).
  - effective types: a single-Node-Type graph with one discriminator attribute
    (karate's `club`) is auto-promoted in /schema/ and surfaced by
    /effective-types/.

Built-ins are loaded directly via fixtures (no async precompute), so the
centrality endpoints are exercised only for their 202/404 polling contract,
not for a computed result (that path is async and covered by the live app).
"""
import pytest


# ---------------------------------------------------------------------------
# Schema + structural metadata
# ---------------------------------------------------------------------------

class TestSchema:
    def test_schema_shape(self, client, karate):
        r = client.get(f"/schema/{karate}")
        assert r.status_code == 200
        s = r.json()
        for key in ("nodes", "edges", "directed", "node_types", "edge_types",
                    "degree_range", "auto_promoted", "node_types_detail"):
            assert key in s
        assert s["nodes"] == 34          # Zachary's karate club
        assert s["directed"] is False

    def test_schema_auto_promotion(self, client, karate):
        """Karate has one Node Type + a `club` attribute → auto-promoted."""
        s = client.get(f"/schema/{karate}").json()
        promo = s["auto_promoted"]["node"]
        assert promo is not None
        assert promo["attr"] == "club"

    def test_schema_404(self, client):
        assert client.get("/schema/nope").status_code == 404


# ---------------------------------------------------------------------------
# Node / edge indices — the canonical orderings everything else builds on
# ---------------------------------------------------------------------------

class TestNodeIndex:
    def test_nodes_degree_desc(self, client, karate):
        """/nodes/ must be sorted by degree descending (the node_idx contract)."""
        nodes = client.get(f"/nodes/{karate}").json()
        assert len(nodes) == 34
        degrees = [n["degree"] for n in nodes]
        assert degrees == sorted(degrees, reverse=True)
        for n in nodes:
            assert {"id", "type", "degree", "wcc_id"} <= n.keys()

    def test_nodes_404(self, client):
        assert client.get("/nodes/nope").status_code == 404


class TestEdgeIndex:
    def test_edges_soa_indices_align_to_nodes(self, client, karate):
        """source[i]/target[i] must be valid indices into /nodes/ ordering."""
        nodes = client.get(f"/nodes/{karate}").json()
        edges = client.get(f"/edges/{karate}").json()
        n = len(nodes)
        assert len(edges["source"]) == len(edges["target"]) == 78  # karate edges
        assert all(0 <= s < n for s in edges["source"])
        assert all(0 <= t < n for t in edges["target"])
        # type[i] indexes edge_types[]
        assert all(0 <= t < len(edges["edge_types"]) for t in edges["type"])

    def test_edges_unweighted_has_no_weight(self, client, uploaded_graph):
        """A graph with no weight attribute → no `weight` array shipped."""
        import networkx as nx
        G = nx.Graph()
        G.add_edges_from([(1, 2), (2, 3), (3, 1)])  # no weights
        graph_id = uploaded_graph(nx.node_link_data(G))
        edges = client.get(f"/edges/{graph_id}").json()
        assert "weight" not in edges

    def test_edges_weighted_has_weight(self, client, movielens):
        """MovieLens edges carry rating as weight (weighted graph)."""
        edges = client.get(f"/edges/{movielens}").json()
        assert "weight" in edges
        assert len(edges["weight"]) == len(edges["source"])


# ---------------------------------------------------------------------------
# Effective types — auto-promotion surfaced per item
# ---------------------------------------------------------------------------

class TestEffectiveTypes:
    def test_karate_node_labels_aligned(self, client, karate):
        """node labels array aligns 1:1 with /nodes/ ordering and uses `club` values."""
        nodes = client.get(f"/nodes/{karate}").json()
        eff = client.get(f"/effective-types/{karate}").json()
        assert eff["promoted"]["node"]["attr"] == "club"
        assert eff["node"] is not None
        assert len(eff["node"]) == len(nodes)
        # karate's two clubs
        assert set(eff["node"]) <= {"Mr. Hi", "Officer"}

    def test_no_promotion_returns_null(self, client, email_eu):
        """email_eu has many real Node Types → nothing to promote on the node side."""
        eff = client.get(f"/effective-types/{email_eu}").json()
        assert eff["promoted"]["node"] is None
        assert eff["node"] is None


# ---------------------------------------------------------------------------
# Attribute index — per-(type, attr) filter buckets
# ---------------------------------------------------------------------------

class TestAttributeIndex:
    def test_shape(self, client, karate):
        idx = client.get(f"/attribute-index/{karate}").json()
        assert "node_attrs" in idx and "edge_attrs" in idx

    def test_404(self, client):
        assert client.get("/attribute-index/nope").status_code == 404


# ---------------------------------------------------------------------------
# Analysis endpoints — contract + full-graph (mask-only) invariant
# ---------------------------------------------------------------------------

class TestComponents:
    def test_wcc_present(self, client, karate):
        c = client.get(f"/components/{karate}").json()
        assert "wcc" in c
        assert c["wcc"]["count"] >= 1
        # karate is one connected component
        assert c["wcc"]["lcc_size"] == 34

    def test_scc_only_directed(self, client, karate, email_eu):
        assert "scc" not in client.get(f"/components/{karate}").json()
        assert "scc" in client.get(f"/components/{email_eu}").json()


class TestMetrics:
    def test_degree_payload(self, client, karate):
        m = client.get(f"/metrics/{karate}").json()
        assert len(m["degree_sequence"]) == 34
        assert "degree_stats" in m and "degree_by_type" in m


class TestDegreeFit:
    def test_shape(self, client, karate):
        f = client.get(f"/degree-fit/{karate}").json()
        assert "all" in f
        assert set(f["all"].keys()) >= {"powerlaw", "exponential", "poisson", "lognormal"}


class TestTypeMixing:
    def test_metadata_only(self, client, karate):
        """type-mixing ships metadata + assortativity; matrix is client-side."""
        t = client.get(f"/type-mixing/{karate}").json()
        assert "assortativity" in t and "node_types" in t
        # no precomputed matrix in the payload (mask-only: client recomputes it)
        assert "matrix" not in t


class TestEdgeFlow:
    def test_metadata_only(self, client, karate):
        e = client.get(f"/edge-flow/{karate}").json()
        assert {"node_types", "edge_types", "node_counts"} <= e.keys()
        assert "flows" not in e  # aggregated client-side


class TestTimeline:
    def test_movielens_has_temporal(self, client, movielens):
        """MovieLens carries release_year (node) and rating_date (edge)."""
        t = client.get(f"/timeline/{movielens}").json()
        assert "per_attr_node" in t and "per_attr_edge" in t
        # at least one temporal attr discovered on some scope
        assert t["temporal_attrs_node"] or t["temporal_attrs_edge"]


# ---------------------------------------------------------------------------
# Ego — BFS subgraph with edge_id back-references
# ---------------------------------------------------------------------------

class TestEgo:
    def test_ego_contains_center_and_edge_ids(self, client, karate):
        nodes = client.get(f"/nodes/{karate}").json()
        center = nodes[0]["id"]  # highest-degree node
        ego = client.get(f"/ego/{karate}/{center}?k=1").json()
        ids = {n["id"] for n in ego["nodes"]}
        assert center in ids
        # every edge carries the canonical edge_id for client-side masking
        assert all("edge_id" in e for e in ego["edges"])

    def test_ego_invalid_direction_400(self, client, karate):
        nodes = client.get(f"/nodes/{karate}").json()
        center = nodes[0]["id"]
        assert client.get(f"/ego/{karate}/{center}?direction=sideways").status_code == 400

    def test_ego_unknown_node_404(self, client, karate):
        assert client.get(f"/ego/{karate}/does-not-exist").status_code == 404


# ---------------------------------------------------------------------------
# Inspectors
# ---------------------------------------------------------------------------

class TestInspectors:
    def test_node_inspect(self, client, karate):
        nodes = client.get(f"/nodes/{karate}").json()
        r = client.get(f"/node-inspect/{karate}/{nodes[0]['id']}")
        assert r.status_code == 200
        payload = r.json()
        assert {"id", "type", "attributes", "structural", "neighbors"} <= payload.keys()

    def test_edge_inspect_by_id(self, client, karate):
        """edge_id 0 must resolve to a source/target pair."""
        r = client.get(f"/edge-inspect/{karate}/0")
        assert r.status_code == 200
        e = r.json()
        assert e["edge_id"] == 0
        assert "source" in e and "target" in e

    def test_edge_inspect_out_of_range_404(self, client, karate):
        assert client.get(f"/edge-inspect/{karate}/999999").status_code == 404


# ---------------------------------------------------------------------------
# Centrality polling contract (async result not awaited here)
# ---------------------------------------------------------------------------

class TestCentralityPolling:
    def test_status_404_for_unknown(self, client):
        assert client.get("/centrality-status/nope").status_code == 404

    def test_data_endpoints_unknown_404(self, client):
        for measure in ("spectral", "betweenness", "closeness"):
            assert client.get(f"/centrality/{measure}/nope").status_code == 404


# ---------------------------------------------------------------------------
# Datasets listing
# ---------------------------------------------------------------------------

class TestDatasets:
    def test_list_includes_builtins(self, client):
        r = client.get("/datasets/")
        assert r.status_code == 200
        names = {d["name"] for d in r.json()["datasets"]}
        assert {"karate", "movielens_small"} <= names
