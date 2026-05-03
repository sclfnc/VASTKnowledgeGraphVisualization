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
def uploaded_graph(client, sample_graph):
    """Upload a sample graph and return the graph_id."""
    data = nx.node_link_data(sample_graph)

    with tempfile.NamedTemporaryFile(mode='w', suffix='.json', delete=False) as f:
        json.dump(data, f)
        temp_file = f.name

    try:
        with open(temp_file, 'rb') as f:
            response = client.post("/upload/", files={"file": f})

        assert response.status_code == 201
        graph_id = response.json()["graph_id"]
        yield graph_id
    finally:
        if os.path.exists(temp_file):
            os.unlink(temp_file)


@pytest.fixture(scope="function")
def default_graph(client, uploaded_graph):
    """Set a graph as default and return the graph_id."""
    graph_id = uploaded_graph
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
