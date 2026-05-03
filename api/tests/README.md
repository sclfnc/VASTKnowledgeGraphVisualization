# Tests Directory

This directory contains the comprehensive test suite for the NetworkX Graph API.

## Test Structure

### `conftest.py`
Contains pytest fixtures that are shared across all test files:
- `client()`: FastAPI test client
- `empty_registry()`: Ensures graph_registry is empty before each test
- `sample_graph()`: Creates a sample directed graph with edge types
- `sample_graph_with_node_types()`: Creates a sample graph with node types
- `uploaded_graph()`: Uploads a sample graph and returns the graph_id
- `default_graph()`: Sets a graph as default and returns the graph_id
- `graph_storage_dir()`: Ensures graph storage directory exists
- `cleanup_graph_storage()`: Cleans up graph storage after tests

### `test_api.py`
Main test suite covering:
- **Graph Upload**: Testing graph upload functionality with various scenarios
- **Graph Summary**: Testing the summary endpoint for different graph properties
- **Node Types**: Testing node type counting functionality
- **Edge Types**: Testing edge type counting functionality
- **Default Graph**: Testing default graph functionality
- **Health Check**: Testing the health check endpoint
- **Edge Cases**: Testing special scenarios like empty graphs, graphs without types, etc.
- **Comprehensive**: Integration tests covering full workflows

### `test_default_graph_file.py`
Tests specifically for the `default-graph.json` file in `graph_storage`:
- Verifies the file can be accessed and analyzed
- Tests setting it as the default graph
- Tests node and edge type counting on the actual file
- Tests file-based workflows

## Running Tests

### Basic Test Execution

```bash
# Run all tests
pytest

# Run tests with verbose output
pytest -v

# Run tests with very verbose output
pytest -vv

# Run specific test file
pytest tests/test_api.py

# Run specific test class
pytest tests/test_api.py::TestGraphUpload

# Run specific test method
pytest tests/test_api.py::TestGraphUpload::test_upload_valid_graph
```

### Selective Test Execution

```bash
# Run only fast tests (exclude slow tests)
pytest -m "not slow"

# Run only integration tests
pytest -m integration

# Run only unit tests
pytest -m unit
```

### Test Coverage

```bash
# Run tests with coverage
pytest --cov=.

# Run tests with coverage and generate HTML report
pytest --cov=. --cov-report=html
```

## Test Fixtures

The test suite uses pytest fixtures to provide:
- Clean test environments
- Reusable test data
- Proper setup and teardown

Fixtures are defined in `conftest.py` and can be used across all test files.

## Test Data

Tests use both:
1. **Synthetic graphs**: Programmatically created graphs for specific test scenarios
2. **File-based graphs**: The actual `default-graph.json` file in `graph_storage` for realistic testing

## Best Practices

1. **Isolation**: Each test should be independent and not rely on state from other tests
2. **Fixtures**: Use fixtures for common setup and teardown
3. **Assertions**: Use clear, specific assertions
4. **Error Handling**: Test both success and failure scenarios
5. **Cleanup**: Ensure resources are cleaned up after tests

## Test Categories

- **Unit Tests**: Test individual components in isolation
- **Integration Tests**: Test interactions between components
- **End-to-End Tests**: Test complete user workflows
- **Edge Case Tests**: Test unusual or boundary conditions
