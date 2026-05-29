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
- `load_builtin()`: Factory that loads a built-in dataset and yields its graph_id (cleans up files after)
- `karate()` / `email_eu()` / `movielens()`: Convenience fixtures over `load_builtin` for the three datasets the modular suite exercises
- `seed_default_graph()`: Session-scoped, autouse. Writes a synthetic `graph_storage/default-graph.json` (using MC1's type names) so the file-based tests below pass on a clean, offline checkout, then removes it. Leaves a real `default-graph.json` untouched if one is already present.

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

> Note: `test_api.py`, `test_cors.py` and `test_default_graph_file.py` are the upstream files,
> **vendored here unchanged**. Upstream, `test_default_graph_file.py` runs against the
> non-redistributable MC1 `default-graph.json`; here the `seed_default_graph` fixture writes a small
> synthetic stand-in (with MC1's type names) so the suite is green on a clean checkout — see the
> fixture note above. The test files themselves are not modified.

### `test_modular.py`
Test suite for the modular endpoints added on top of the legacy contract (the per-panel data
endpoints, indices, and analysis routes). Loads real built-in datasets via the `karate` / `email_eu`
/ `movielens` fixtures and checks each endpoint's payload shape and key invariants, grouped by class:
- **Schema**: auto-promotion of a single-type graph's discriminator attribute (Karate's `club`)
- **NodeIndex / EdgeIndex**: degree-desc node ordering, SoA edge index alignment, weighted vs unweighted payloads
- **EffectiveTypes / AttributeIndex**: effective-type labels and the per-(type, attr) filter buckets
- **Components / Metrics / DegreeFit**: WCC/SCC breakdown, degree payload, distribution fits
- **TypeMixing / EdgeFlow**: metadata-only payloads (matrix/flows are recomputed client-side)
- **Timeline / Ego / Inspectors**: temporal bins, k-hop subgraph (`edge_id` refs, 400/404 paths), per-node/edge inspector payloads
- **CentralityPolling / Datasets**: status polling contract and the built-in dataset listing

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

> Applies to the legacy suite: these markers (`slow` / `integration` / `unit`) are defined for the
> upstream tests. `test_modular.py` does not register them.

```bash
# Run only fast tests (exclude slow tests)
pytest -m "not slow"

# Run only integration tests
pytest -m integration

# Run only unit tests
pytest -m unit
```

### Test Coverage

> Applies to the legacy suite: requires `pytest-cov`, which is part of the upstream tooling and is not
> in the modular dev requirements (`requirements-dev.txt`).

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

Tests use:
1. **Synthetic graphs**: Programmatically created graphs for specific test scenarios
2. **File-based graphs**: The actual `default-graph.json` file in `graph_storage` for realistic testing
3. **Built-in datasets**: Real graphs (Karate, Email-Eu-core, MovieLens) loaded through the built-in
   loaders, used by `test_modular.py` to exercise the per-panel endpoints on representative data

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
