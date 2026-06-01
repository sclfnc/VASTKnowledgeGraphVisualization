"""
Tests specifically for the default-graph.json file in graph_storage.

These tests verify that the API can properly handle the pre-existing
default-graph.json file in the graph_storage directory.
"""

import pytest
import os
from pathlib import Path


class TestDefaultGraphFile:
    """Test cases for the default-graph.json file in graph_storage."""

    @pytest.fixture(scope="class")
    def default_graph_file_exists(self):
        """Check if default-graph.json exists in graph_storage."""
        default_graph_path = Path("graph_storage") / "default-graph.json"
        return default_graph_path.exists()

    def test_default_graph_file_exists(self, default_graph_file_exists):
        """Verify that default-graph.json exists."""
        assert default_graph_file_exists, "default-graph.json should exist in graph_storage"

    def test_set_default_using_filename(self, client, default_graph_file_exists):
        """Test setting default using 'default-graph' as the filename (without .json)."""
        if not default_graph_file_exists:
            pytest.skip("default-graph.json not found in graph_storage")

        # Try to set default using the filename without extension
        response = client.post("/set-default/default-graph")
        assert response.status_code == 200
        assert response.json()["message"] == "Graph set as default successfully"

    def test_access_default_graph_summary(self, client, default_graph_file_exists):
        """Test accessing summary for the default-graph.json file."""
        if not default_graph_file_exists:
            pytest.skip("default-graph.json not found in graph_storage")

        # First set it as default
        response = client.post("/set-default/default-graph")
        assert response.status_code == 200

        # Now access via default endpoint
        response = client.get("/summary/default")
        assert response.status_code == 200
        summary = response.json()

        # Verify it has the expected structure
        assert "graph_id" in summary
        assert "basic_properties" in summary
        assert "node_properties" in summary
        assert "edge_properties" in summary
        assert "node_type_properties" in summary
        assert "edge_type_properties" in summary

        # The default graph should have many nodes and edges
        assert summary["basic_properties"]["number_of_nodes"] > 0
        assert summary["basic_properties"]["number_of_edges"] > 0

    def test_default_graph_node_types(self, client, default_graph_file_exists):
        """Test node type counting for default-graph.json."""
        if not default_graph_file_exists:
            pytest.skip("default-graph.json not found in graph_storage")

        # Set as default
        response = client.post("/set-default/default-graph")
        assert response.status_code == 200

        # Access node types via default endpoint
        response = client.get("/node-types/default")
        assert response.status_code == 200
        result = response.json()

        # Verify node types are counted
        assert "node_type_counts" in result
        assert "total_nodes" in result
        assert result["total_nodes"] > 0

        # Based on the file preview, we should have Person, Song, and RecordLabel types
        node_types = result["node_type_counts"]
        assert "Person" in node_types or "Song" in node_types or "RecordLabel" in node_types

    def test_default_graph_edge_types(self, client, default_graph_file_exists):
        """Test edge type counting for default-graph.json."""
        if not default_graph_file_exists:
            pytest.skip("default-graph.json not found in graph_storage")

        # Set as default
        response = client.post("/set-default/default-graph")
        assert response.status_code == 200

        # Access edge types via default endpoint
        response = client.get("/edge-types/default")
        assert response.status_code == 200
        result = response.json()

        # Verify edge types are counted
        assert "edge_type_counts" in result
        assert "total_edges" in result
        assert result["total_edges"] > 0

    def test_default_graph_in_summary_endpoint(self, client, default_graph_file_exists):
        """Test that default-graph.json has node and edge types in summary."""
        if not default_graph_file_exists:
            pytest.skip("default-graph.json not found in graph_storage")

        # Set as default
        response = client.post("/set-default/default-graph")
        assert response.status_code == 200

        # Get summary
        response = client.get("/summary/default")
        assert response.status_code == 200
        summary = response.json()

        # Verify node types are in summary
        assert "node_type_properties" in summary
        assert "node_type_counts" in summary["node_type_properties"]
        node_types = summary["node_type_properties"]["node_type_counts"]
        assert len(node_types) > 0

        # Verify edge types are in summary
        assert "edge_type_properties" in summary
        assert "edge_type_counts" in summary["edge_type_properties"]
        edge_types = summary["edge_type_properties"]["edge_type_counts"]
        assert len(edge_types) > 0

    def test_access_default_graph_directly_by_filename(self, client, default_graph_file_exists):
        """Test accessing the default-graph.json directly by its filename."""
        if not default_graph_file_exists:
            pytest.skip("default-graph.json not found in graph_storage")

        # Access summary directly using the filename (without .json)
        response = client.get("/summary/default-graph")
        assert response.status_code == 200
        summary = response.json()

        # Should have the same structure as accessing via default
        assert "basic_properties" in summary
        assert summary["basic_properties"]["number_of_nodes"] > 0

        # Also test node types
        response = client.get("/node-types/default-graph")
        assert response.status_code == 200
        result = response.json()
        assert "node_type_counts" in result

        # And edge types
        response = client.get("/edge-types/default-graph")
        assert response.status_code == 200
        result = response.json()
        assert "edge_type_counts" in result


class TestFileBasedWorkflow:
    """Test workflows that use actual files in graph_storage."""

    def test_multiple_graphs_in_storage(self, client):
        """Test that multiple graphs can be accessed from storage."""
        # Get list of JSON files in graph_storage
        storage_path = Path("graph_storage")
        json_files = list(storage_path.glob("*.json"))

        # Should have at least the default-graph.json
        assert len(json_files) > 0

        # Try to access one of them
        test_file = json_files[0]
        filename_without_ext = test_file.stem

        # Set as default
        response = client.post(f"/set-default/{filename_without_ext}")
        assert response.status_code == 200

        # Access via default
        response = client.get("/summary/default")
        assert response.status_code == 200
        summary = response.json()
        assert "basic_properties" in summary

    def test_storage_file_with_node_and_edge_types(self, client):
        """Test a storage file that has both node and edge types."""
        # Use default-graph.json if it exists
        default_graph_path = Path("graph_storage") / "default-graph.json"
        if not default_graph_path.exists():
            pytest.skip("default-graph.json not found")

        # Access via filename
        response = client.get("/summary/default-graph")
        assert response.status_code == 200
        summary = response.json()

        # Should have both node and edge type properties
        assert "node_type_properties" in summary
        assert "edge_type_properties" in summary

        node_types = summary["node_type_properties"]["node_type_counts"]
        edge_types = summary["edge_type_properties"]["edge_type_counts"]

        # Should have multiple types
        assert len(node_types) > 1 or len(edge_types) > 1
