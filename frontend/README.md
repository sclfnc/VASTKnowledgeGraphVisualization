# Telescope — Frontend

Vue 3 (`<script setup>`) SPA built with Vite: Pinia + Vue Router, Tailwind CSS v4, D3 for the chart
panels, Lucide for icons, `@vueform/slider` for range controls. ESLint (flat config) + Oxlint.

> **Source structure, design system, and conventions live in
> [`docs/sclfnc/frontend.md`](../docs/sclfnc/frontend.md)**; the cross-panel contract in
> [`docs/sclfnc/contract.md`](../docs/sclfnc/contract.md); the D3 panel system in
> [`docs/sclfnc/panels.md`](../docs/sclfnc/panels.md). This file is setup only.

## Setup

```bash
npm install
npm run dev      # Vite dev server + HMR on :5173
npm run build
npm run preview
npm run lint
```

Requires Node `^20.19.0 || >=22.12.0`. Vite proxies API calls to FastAPI on `:8000`.
