# Telescope — Documentation

The reference implementation of the VAST 2025 Design Challenge dashboard: a FastAPI backend plus a
Vue 3 + D3 frontend, by [@sclfnc](https://github.com/sclfnc).

This folder is the knowledge base for that work. The setup and conventions of each part of the
codebase live in the README inside its folder; the design that spans the whole project lives here.

## Start here

- **[design.md](design.md)** — what Telescope is, who it is for, how panels stay in sync, the built-in
  datasets, scope and limitations, and notes on MC1.
- **[contract.md](contract.md)** — the cross-panel interaction contract: the three shared bitmaps,
  mask-only semantics, effective-type, Lock, selection caps, the upstream-write policy, and the
  open-ideas backlog. Every panel obeys this.
- **[backend.md](backend.md)** — backend architecture: the stateless design model, module layout and
  dependency DAG, the endpoint catalogue, conventions, and how to extend it.
- **[frontend.md](frontend.md)** — frontend architecture: source structure, the design system, and the
  key conventions.
- **[panels.md](panels.md)** — the D3 panel catalogue, the spec format, and how a panel binds to shared
  state.

## Running it

A root-level `dev.sh` launches backend and frontend together and shuts them down on `Ctrl+C`. It
creates/activates `api/venv`, installs Python + Node dependencies on first run (and re-installs only
when the requirement/lock hashes change), then starts uvicorn (`:8000`) and Vite (`:5173`).

```bash
./dev.sh            # quiet
./dev.sh --dev      # also install test deps and run the API suite first (non-blocking)
./dev.sh --log      # stream full pip/npm output (networkit builds from source)
```

Requires a Linux shell with `bash`, `python3`, and Node/`npm` (Node `^20.19.0 || >=22.12.0`). The
flags combine: `./dev.sh --dev --log`. For manual backend/frontend startup, see the per-folder READMEs.

## Where each piece is documented

Design and architecture live here; setup and code-level how-tos stay in the per-folder READMEs.

| Topic | Where |
|-------|-------|
| Design rationale, audiences, scope, MC1 | [design.md](design.md) |
| Cross-panel contract (bitmaps, mask-only, Lock) | [contract.md](contract.md) |
| Backend architecture, endpoints, conventions | [backend.md](backend.md) |
| Frontend architecture, design system, conventions | [frontend.md](frontend.md) |
| D3 panel catalogue + spec format | [panels.md](panels.md) |
| Backend setup | [`api/README.md`](../../api/README.md) |
| Backend test suite | [`api/tests/README.md`](../../api/tests/README.md) |
| Frontend setup | [`frontend/README.md`](../../frontend/README.md) |
| Panel authoring how-to + `shared.js` | [`frontend/src/panels/README.md`](../../frontend/src/panels/README.md) |
| Data download script | [`data/README.md`](../../data/README.md) |

## Stack

| Area     | Tech |
| -------- | ---- |
| Frontend | Vue 3 · Vite · Pinia · Vue Router · Tailwind CSS v4 · D3 · Lucide · @vueform/slider |
| Backend  | FastAPI · NetworkX · NetworKit (centralities) · powerlaw (CSN distribution fits) |

## Author

Francesco Secoli — [github.com/sclfnc](https://github.com/sclfnc).
Repository: [github.com/sclfnc/VASTKnowledgeGraphVisualization](https://github.com/sclfnc/VASTKnowledgeGraphVisualization)
