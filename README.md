# VAST Knowledge Graph Visualization

Collaborative project developed by students of the **Course on Visual Analytics** in response to the **VAST Challenge 2025 – Design Challenge**.

> Challenge page: https://vast-challenge.github.io/2025/DC.html

## Overview

This repository is intended to host the research, design material, prototypes, and documentation produced for the 2025 VAST Design Challenge. The challenge asks participants to conceive a **visual analytics design for knowledge graphs** that helps non-expert users:

- discover new information or relationships,
- identify anomalies or inconsistencies, and/or
- infer missing information from context.

Knowledge graphs combine graph structure with rich, heterogeneous node and edge attributes. This creates important visualization challenges related to scale, uncertainty, incomplete information, and interpretability. Our project explores how visual analytics can support these tasks through an accessible and well-justified design.

## Project Goals

The main goals of this collaborative project are to:

1. study the VAST 2025 Design Challenge requirements;
2. investigate visual encodings and interaction techniques for knowledge-graph exploration; (see [Notes of meeting 1](docs/meeting_1_notes.md))
3. design a visual analytics solution that supports the challenge tasks;
4. document the design rationale, limitations, and intended user workflow;
5. coordinate the contributions of the student team.

## Challenge Context

According to the challenge brief, the final submission should focus on a **design**, not necessarily a fully working prototype. However, within the class we will explore factual implementations using Vue.js and D3.js to have a final tool that can be used to demonstrate the design.

Any suitable knowledge-graph-like dataset may be used to motivate or illustrate the design. The emphasis is on visual analytics thinking and design interactivity capable of supporting multiple domain scenarios.

## Repository Status

This repository tracks the team's meetings and design decisions. A working reference implementation
— a FastAPI backend plus a Vue 3 + D3 frontend ("Telescope") — is developed by [@sclfnc](https://github.com/sclfnc);
see [`docs/sclfnc/`](docs/sclfnc/) for its design, contract, and usage.

### Where things live

| Path | What's inside |
| --- | --- |
| `frontend/src/views/` | The main pages: `DatasetView` (data loading), `GuideView` (the dashboard), `HomeView`. |
| `frontend/src/panels/` | The D3 charts (degree, components, centrality, ego, type-mixing, edge-flow, timeline) and the panel list in `index.js`. |
| `frontend/src/components/` | Reusable interface parts: sidebar, panel card, detail modal, graph status. |
| `frontend/src/composables/` | Shared logic: loading data from the API, the filter model, the force-graph, the type colors. |
| `frontend/src/stores/` | Application state (Pinia): filters, selection, isolation, panels, user preferences. |
| `frontend/src/utils/` | `bitset.js` and `binsearch.js`, the building blocks used to apply filters. |
| `api/` | The FastAPI backend. `main.py` connects everything; each feature has its own file (`schema`, `centrality`, `ego`, and so on). |
| `api/tests/` | The backend tests. |
| `docs/` | Meeting notes and the `sclfnc/` design documentation. |


## Working Approach

A possible workflow for the team is:

1. **Interpret the challenge**
   - identify the analytical tasks the team wants to support;
   - define the target user and usage scenario.

2. **Explore design alternatives**
   - compare different visual representations for large, attributed, uncertain graphs;
   - evaluate trade-offs between overview, detail, explainability, and interaction complexity.

3. **Develop and refine the concept**
   - create sketches, wireframes, or interactive mockups;
   - gather feedback during class reviews or team meetings;
   - refine the design rationale and task support.

4. **Prepare final deliverables**
   - write the final design description;
   - document limitations and assumptions;
   - assemble supporting visuals, storyboard, and reflection material.

## Collaboration Guidelines

To keep the project organized, contributors may follow these practices:

- create focused branches for substantial changes;
- use clear commit messages;
- document design decisions in markdown files under `docs/`;
- store figures and interface mockups in `assets/`.


## Team

This project is developed collaboratively by students of the **Course on Visual Analytics**.

- Francesco Secoli — [@sclfnc](https://github.com/sclfnc) (reference implementation: backend + Telescope frontend)

This section will be later expanded with the list of participants.

## References

- VAST Challenge 2025 – Design Challenge: https://vast-challenge.github.io/2025/DC.html
- IEEE VIS / VAST community resources on visual analytics, graph visualization, and knowledge graphs

## Deployment Constraint — Single Worker Only

The backend keeps **all its state in memory** (the graph registry, the caches, the centrality tasks). There is no database and no shared store. This is a deliberate choice: the prototype is built for design, and only one analyst uses it at a time. The dev script runs `uvicorn main:app --reload` with no `--workers` flag, so there is only one process.

**Do not run it with `--workers N` (N > 1)** or in any setup with more than one process. Each worker would keep its own separate registry, so a graph loaded by one worker would not be visible to the others.

