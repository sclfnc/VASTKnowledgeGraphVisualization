# Telescope — Backend

FastAPI server: loads a graph, computes graph-analysis payloads per panel, serves them as JSON.
Read-only and stateless across restarts (the registry is in-memory). The Vue frontend is the only client.

> **Architecture, design model, endpoint catalogue, conventions, and how to extend the backend live in
> [`docs/sclfnc/backend.md`](../docs/sclfnc/backend.md).** This file is setup and tests only.

## Setup

```bash
cd api
python -m venv venv
source venv/bin/activate          # Windows: venv\Scripts\activate
pip install -r requirements.txt
uvicorn main:app --reload --port 8000
```

`--reload` reloads the code on edit but **not** the in-memory caches — to see a recomputed payload on a
graph that is already loaded, reload the dataset from the frontend.

Four built-ins (karate, les_misérables, florentine, davis) are generated in-process by NetworkX and
need nothing. The two larger ones — **email-eu-core** (SNAP, BSD) and **MovieLens** (GroupLens,
CC BY 4.0) — are fetched from their official host on first load and cached in
`graph_storage/builtin_data/` (see `builtin_download.py`); they are not committed. A failed download
returns a `503` for that dataset instead of crashing. The first load of those two needs network access.

## Testing (upstream suite)

The compatibility target is the upstream `tests/` suite (`test_api.py`, `test_cors.py`,
`test_default_graph_file.py`), vendored here unchanged alongside the modular suite (`test_modular.py`):

```bash
pip install pytest httpx   # or: ./dev.sh --dev (installs + runs the suite)
python3 -m pytest tests/ -q
```

Expected: all API-contract tests pass (upload, summary, node/edge types, set-default, health, CORS,
full workflow). The test files are vendored unchanged; the only local change is in `tests/conftest.py`,
a session fixture (`seed_default_graph`) that writes a small synthetic `graph_storage/default-graph.json`.
`test_default_graph_file.py` expects that file and checks for MC1 type names (`Person` / `Song` /
`RecordLabel`, …). Upstream, that file *is* the MC1 graph — the VAST Challenge dataset, which cannot
be redistributed, so it is never committed (`graph_storage/` is gitignored). The fixture stands in for
it with MC1's type names, then removes it after the run. A real `default-graph.json` already present
locally is left untouched.

See [`tests/README.md`](tests/README.md) for the test-suite breakdown and selective execution.
