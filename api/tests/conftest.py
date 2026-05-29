"""
Pytest configuration and fixtures for the NetworkX Graph API tests.
"""

import pytest
import networkx as nx
import json
import tempfile
import os
from fastapi.testclient import TestClient
from pathlib import Path

# Import the FastAPI app
from main import app, graph_registry, GRAPH_STORAGE_DIR, default_graph_id


@pytest.fixture(scope="function")
def client():
    """FastAPI test client fixture."""
    return TestClient(app)


@pytest.fixture(scope="function")
def empty_registry():
    """Fixture to ensure graph_registry is empty before each test."""
    # Save current registry state
    original_registry = dict(graph_registry)

    # Clear registry
    graph_registry.clear()

    yield

    # Restore original registry state
    graph_registry.clear()
    graph_registry.update(original_registry)


@pytest.fixture(scope="function")
def sample_graph():
    """Create a sample directed graph for testing."""
    G = nx.DiGraph()
    G.add_nodes_from([1, 2, 3, 4, 5])
    G.add_edges_from([
        (1, 2, {'weight': 2.5, 'Edge Type': 'Friendship'}),
        (1, 3, {'weight': 1.0, 'Edge Type': 'Friendship'}),
        (2, 3, {'weight': 0.5, 'Edge Type': 'Follows'}),
        (2, 4, {'weight': 1.5, 'Edge Type': 'Follows'}),
        (3, 4, {'weight': 3.0, 'Edge Type': 'Follows'}),
        (4, 5, {'weight': 2.0, 'Edge Type': 'Family'}),
        (5, 1, {'weight': 1.0, 'Edge Type': 'Family'})
    ])
    return G


@pytest.fixture(scope="function")
def sample_graph_with_node_types():
    """Create a sample graph with node types."""
    G = nx.DiGraph()
    G.add_nodes_from([
        (1, {'Node Type': 'User'}),
        (2, {'Node Type': 'User'}),
        (3, {'Node Type': 'Admin'}),
        (4, {'Node Type': 'Service'}),
        (5, {'Node Type': 'Service'})
    ])
    G.add_edges_from([
        (1, 2, {'weight': 1.0}),
        (2, 3, {'weight': 2.0}),
        (3, 4, {'weight': 1.5}),
        (4, 5, {'weight': 2.5}),
        (5, 1, {'weight': 1.0})
    ])
    return G


@pytest.fixture(scope="function")
def uploaded_graph(client, sample_graph, graph_storage_dir):
    """
    Upload a graph created with specified data and return the graph_id.

    Args:
        data: a NetworkX graph in node-link format. A sample graph is used when not specified.
    """
    created_graphs = []

    def _upload_graph(data=None):
        if data is None:
            data = nx.node_link_data(sample_graph)

        with tempfile.NamedTemporaryFile(mode='w', suffix='.json', delete=False) as f:
            json.dump(data, f)
            temp_file = f.name

        try:
            with open(temp_file, 'rb') as f:
                response = client.post("/upload/", files={"file": f})

            assert response.status_code == 201
            graph_id = response.json()["graph_id"]
            created_graphs.append(graph_id)
            return graph_id

        finally:
            if os.path.exists(temp_file):
                os.unlink(temp_file)

    yield _upload_graph

    # Clean up graph storage
    graph_storage_path = Path(graph_storage_dir)
    for graph_id in created_graphs:
        graph_file = graph_storage_path / f"{graph_id}.json"
        if os.path.exists(graph_file):
            graph_file.unlink()


@pytest.fixture(scope="function")
def default_graph(client, uploaded_graph):
    """Set a graph as default and return the graph_id."""
    graph_id = uploaded_graph()
    response = client.post(f"/set-default/{graph_id}")
    assert response.status_code == 200
    yield graph_id


@pytest.fixture(scope="function")
def graph_storage_dir():
    """Ensure graph storage directory exists."""
    Path(GRAPH_STORAGE_DIR).mkdir(exist_ok=True)
    return GRAPH_STORAGE_DIR


@pytest.fixture(scope="function")
def cleanup_graph_storage():
    """Clean up graph storage directory after tests."""
    # Get list of files before test
    storage_path = Path(GRAPH_STORAGE_DIR)
    original_files = set(f.name for f in storage_path.iterdir() if f.is_file())

    yield

    # Remove any new files created during test
    new_files = set(f.name for f in storage_path.iterdir() if f.is_file()) - original_files
    for filename in new_files:
        (storage_path / filename).unlink()


# ---------------------------------------------------------------------------
# Fixtures for the modular backend (test_modular.py).
# Built-in datasets are loaded directly (no /datasets/load/ endpoint) so tests
# don't depend on the async centrality precompute. Each loader registers the
# graph and returns its graph_id, then cleans up the on-disk file afterwards.
# ---------------------------------------------------------------------------

@pytest.fixture(scope="function")
def load_builtin():
    """Factory: load_builtin(name) -> graph_id. Open built-ins only (no MC1)."""
    import datasets as datasets_mod

    created = []

    def _load(name):
        graph_id = datasets_mod.load_builtin_payload(name)
        created.append(graph_id)
        return graph_id

    yield _load

    storage = Path(GRAPH_STORAGE_DIR)
    for graph_id in created:
        f = storage / f"{graph_id}.json"
        if f.exists():
            f.unlink()


@pytest.fixture(scope="function")
def karate(load_builtin):
    """Undirected, single Node Type + `club` attribute → exercises auto-promotion."""
    return load_builtin("karate")


@pytest.fixture(scope="function")
def email_eu(load_builtin):
    """Directed, many node types (departments) → exercises directed-only branches."""
    return load_builtin("email_eu_core")


@pytest.fixture(scope="function")
def movielens(load_builtin):
    """Bipartite, weighted edges + temporal attrs → exercises weight/timeline paths."""
    return load_builtin("movielens_small")
