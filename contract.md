# The contract

The single source for cross-panel behaviour. Every panel obeys this. Four contracts (bitmap-truth,
mask-only, effective-type, Lock) plus the selection caps, the upstream-write proposals, the
anti-patterns, and the open-ideas backlog. Per-panel specifics (what each one reads/writes) live in
the code — the panel components in `frontend/src/panels/` and the registry `index.js`.

## 1. Bitmap-truth (the three shared bitmaps)

Common state lives in two Pinia stores (`filters`, `selection`) and is exposed as **three public
bitmaps** that every panel consumes via [`usePanelContext`](frontend/src/composables/usePanelContext.js):

| Bitmap | Source store | Built in | Predicate |
|--------|--------------|----------|-----------|
| `activeNodeMask` | `filters` | `useFilteredModel` | `isActive(id)` |
| `activeEdgeMask` | `filters` | `useFilteredModel` | `isEdgeActive(edgeId)` |
| `selectedMask` / `selectedEdgeMask` | `selection` | `usePanelContext` | `isSelected(id)` / `isEdgeSelected(edgeId)` |

The contract is **"consume the mask", not "be internally a bitmap"**: a panel complies if its
narrowing is driven by these masks, regardless of how it stores its own data. No panel reads
`filters.*` raw to bypass a mask — the only allowed raw read is reflecting a widget the panel itself
edits (e.g. `ConnectedComponents` reading `wccFilter` to highlight its Top-N button). Panel-private
`controls` (log scale, top-N, bin size) touch no bitmap.

**Cross-panel influence is implicit under this contract:** A influences B iff A writes
`filters`/`selection` (see §Upstream writes) and B consumes the resulting bitmap (every panel does).
That is why no relationship matrix is needed — it would repeat `mask-only` in every cell.

Which panel writes what is read off the code: grep a panel component for `filters.` / `selection.`
writes. Today four panels write `filters.*` — `connectivity` (`wccFilter`), `degree` (`degree`, via
plot brush), `timeline_node` / `timeline_edge` (`temporalFilter`) — plus `AttributeFilters` (the
sidebar editor). Everything else writes `selection`.

## 2. Mask-only

Derived quantities **must** stay anchored to the full graph and let filters attenuate only the marks.
Exceptions, by explicit design:

- `type_mixing` — recomputes matrix counts under `activeEdgeMask` client-side. Newman r stays full-graph.
- `edge_flow` — recomputes flow tuples `(src_type, edge_type, dst_type, count)` under `activeEdgeMask`.

These two are *count* views (the point is to see counts shift under a filter), not *distribution*
views. **`timeline_node` / `timeline_edge` are NOT exceptions** (corrected 2026-05-28): each bin ships
its canonical SoA indices (`bins[i].idx`) and the panel counts `idx ∧ activeMask` per bin, so it
reacts to every filter like every other panel.

Any new proposal that diverges from mask-only MUST be flagged `[?]` and added to the Open ideas
backlog below before any code is written.

## 3. Effective-type

When `schema.auto_promoted.{node|edge}` is non-null, the effective type is the discriminator
attribute, not the raw `Node Type` / `Edge Type`. Panels that group, color, or chip-toggle by type
MUST go through [`useEffectiveType`](frontend/src/composables/useEffectiveType.js)
(`nodeType(item)` / `nodeTypeAt(idx)` / `nodeTypeList`). Filter writes against the type chip group
propagate to the effective set via [`useFilteredModel`](frontend/src/composables/useFilteredModel.js).

## 4. Lock (Isolation)

Per-panel full freeze. The snapshot includes filters JSON + selection array + `activeNodeMask.clone()`
+ `activeEdgeMask?.clone()` + selection-edge array; while frozen, `usePanelContext` resolves all
derived state from the snapshot and the panel stops following live mutations until Unlock. Lock is the
only per-panel freeze mechanism (the Pin mechanism that previously existed was removed 2026-05-27).

## Filters

The filter slots (`stores/filters.js`) and what each means beyond what the code shows. Mask
construction is centralized in `useFilteredModel` (node mask first, edge mask then ANDed with it).
The only first-class editor is `AttributeFilters.vue` (mounted twice, `mode='node'|'edge'`, in
`AppSidebar` when `sidebars.mode === 'filters'`): top-level type chip group + structural section
(degree/weight sliders + hide-isolated/hide-self-loops) + per-type attribute accordions. Accordion
headers are self-describing — coverage % + a one-line value summary from `schema.*_types_detail` —
which is why the standalone Attribute Schema panels were folded away.

**Top-level slots:**

- `nodeTypes: string[]` / `edgeTypes: string[]` — allow-lists, effective-type aware (seeded with the effective labels under auto-promotion). Empty `nodeTypes` = no nodes pass.
- `degree: {mode:'absolute', value:[lo,hi]}` — node-side range. `mode` is always `'absolute'` in the store; the `%` toggle in `RangeFilter` is UI-only, never persisted. Edited from the sidebar slider **and** from a brush on the `DegreeDistribution` plot (which also reads it back to pre-position the brush).
- `weight: {mode:'absolute', value:[lo,hi]}` — edge-side range, weighted graphs only. **NaN weights pass** (intentional: ignore-not-filter, don't drop edges that simply lack a weight).
- `hideIsolated: boolean` — drop degree-0 nodes. Greyed in the UI when the degree range already excludes 0.
- `hideSelfLoops: boolean` — drop `source === target` edges. Shown when `schema.self_loops > 0`.
- `wccFilter: number[] | null` — allow-list of component ids (0-based, size-desc, matching `/components/` and `/nodes/.wcc_id`); `null` = all. Written by `ConnectedComponents` (dblclick / Top-N), no general UI in the sidebar.
- `temporalFilter: {attr, scope:'node'|'edge', range:[lo,hi]} | null` — single brushed window from `ActivityTimeline`. Applies only when `scope` matches the side being masked. The chip shows in `GraphHeaderStrip`; no first-class accordion entry.

**Per-type attribute slots** `nodeAttrs: {[type]: {[attr]: AttrFilterSpec}}` and `edgeAttrs` (same
shape, by edge type). Per-type AND-chain: a node passes iff its type has no entry, or matches ALL of
its type's entries. Mutated via `setNodeAttr` / `clearNodeAttrs` (auto-prune empty inner objects).
`AttrFilterSpec` by kind:

- `categorical → {kind, values: string[]}` — chip multi-select.
- `numeric → {kind, range: [lo, hi]}` / `date → {kind, range: [yearLo, yearHi]}` — range slider.
- `boolean → {kind, value: true|false}` — tri-state Any/True/False.
- `text → {kind, query, mode: 'contains'|'equals'}` — high-cardinality identifiers (`name`, `stage_name`). Backend ships these as an `[idx, str]` list (not bucketed); `attrIndex.bitsetFor` scans client-side. Widget is a search input + contains/exact toggle. Makes identifier-only types (Person, RecordLabel, MusicalGroup on MC1) filterable.

No panel reads any filter slot back to recompute — they all see the trimmed mask. The only raw reads
that exist are widget-state reflections of a filter the panel itself edits: `ConnectedComponents`
reads `wccFilter` (Top-N button state), `DegreeDistribution` reads `degree` (to pre-position its plot
brush). Both are legitimate — reflecting your own widget, not bypassing the mask.

**Filter history** (`filterHistory.js`): 20-entry debounced (500 ms) ring buffer, **filters only**
(selection/isolation are not undoable). Restore intersects the snapshot with the current schema's
types so a stale snapshot can't reintroduce a deleted type. Undo/redo live in `GraphHeaderStrip`.

**Slots that deliberately don't exist** (proposals, not gaps): `degreeDirection` (in/out/total —
directed graphs have three degree distributions, today one slider); per-type degree filter ("Person
nodes with deg≥10"); `selectionAsFilter` (deferred — see Tier 4 above). *Removed 2026-05-28: the dead
`hops` and legacy `attributes` slots — phantom state with no reader/writer.*

## Selection caps

Aggregate broadcasts MUST cap on write via `selection.replaceCapped(ids, cap)`, which dedups, caps,
and records `overflow` so the panel can render a "+N more not selected" caption. Source:
[`selection.js`](frontend/src/stores/selection.js).

| Panel                | Cap  | Source constant |
|----------------------|------|-----------------|
| `type_mixing`        | 100  | `SELECTION_CAPS.type_mixing` |
| `edge_flow`          | 200  | `SELECTION_CAPS.edge_flow` |
| `connectivity`       | none | `SELECTION_CAPS.connectivity` (500) still defined but **not applied** since 2026-05-27 — a component click broadcasts all its active node ids so the selection matches the filtered view exactly. |
| `ego_compare` (pies) | 4    | `MAX_LAYERS` (read-time slice) |

Any new aggregate-broadcast proposal must state its cap.

## Upstream writes — proposals to discuss

Panels that write `filters.*` today: `connectivity` (`wccFilter` on dblclick / Top-N), `degree`
(`degree` on plot brush), `timeline_node` / `timeline_edge` (`temporalFilter` on brush). Everything
else routes through `selection`. The proposals below would add more upstream writes, collected here so
the policy stays coherent.

**Tier 1 — shift-click "lift to global filter" — partially adopted.** Keep shift-click only where the
affordance is visible and intuitive; otherwise prefer the explicit "Filter to this" button (Tier 2).
- `degree` shift-click bin → `filters.degree.value = [k, k]`. **Keep** (tooltip on the bin).
- `mix` cell / aux bar, `flow` arc / meta-node → **Drop**; gesture too hidden, use Tier 2 buttons.

**Tier 2 — "Filter to this" buttons — preferred.**
- `graph_status_inspector`: "Filter to type" → `filters.nodeTypes = [thisType]`; "Filter to component" → `filters.wccFilter = [thisNode.wcc_id]`.
- `connectivity`: "Isolate selected" → `filters.wccFilter = unique wcc_ids in selection.ids`.
- `mix`: "Filter to these types" (after a cell is selected) → `filters.nodeTypes = [src, dst]`.
- `flow`: "Filter to this edge/node type" (drawer, when an arc / meta-node is selected).

**Tier 3 — two-way attribute filter writes — `[?]`.**
- `graph_status_inspector` clicking a categorical attr value → `nodeAttrs[type][attr] = {kind:'categorical', values:[value]}`. Ping-pong risk (inspector re-renders under the new mask).
- `tNd` / `tEd` cross-writes with `AttributeFilters` date-kind filters on the same attribute.

**Tier 4 — selection-as-filter — deferred (2026-05-27).** Lock already covers the per-panel freeze
need. If a real request arrives, the preferred path is a global lens toggle that AND-s `selectedMask`
into every panel — not a new `filters.*` slot.

## Anti-patterns to avoid

- **Two-way binding without a guard.** `ego` is the reference: any bidirectional sync needs an `isLocalUpdate`-style flag to prevent ping-pong.
- **Writes that bypass `selection.replace` / `add` / `toggle` (and the edge equivalents).** Direct mutations of `selection.ids` / `edgeIds` break the store's invariants (string IDs, dedup).
- **Writes to `filters.*` that bypass Pinia.** The `filterHistory` subscription is auto-armed; every mutation must go through the store so undo/redo sees it.
- **Capped broadcasts via `replace` + manual `.slice()`.** Use `replaceCapped` so `overflow` is tracked and the "+N more" caption works.

## Open ideas (HCI audit backlog)

Unresolved `[?]`/`[p]` interaction proposals salvaged 2026-05-28 from the per-panel schede (since
deleted — the descriptive 4/8 of each scheda was code restated in prose; only these design ideas were
not derivable from the code). Input for the panel-by-panel HCI audit; none decided yet.

**Drill / brush → selection.**
- `cent_comparison`: brush a mini-scatter → `selection.replace(ids in rectangle)`. Meta-view, may not want drill semantics.
- `ego`: brush a region of the force layout → select the cluster around the ego.
- `cent_closeness`: click a violin → `selection.replaceCapped(idsOfType, cap)` (needs a sensible cap; some types have thousands).
- `type_mixing`: row-label click (vs cell) → `selection.replace(idsOfRowType)` + reset column filter.

**Explicit "filter to this" upstream writes (see §Upstream writes, Tier 2-4).**
- `ego` / `ego_compare`: "Filter to ego ± k-hop" / "Filter to union" — needs an ego-membership filter slot (doesn't exist) or fall back to `wccFilter` (loses k-hop granularity).
- `cent_eigenvector`: "Use anchor's WCC as filter" → `wccFilter = [anchor.wcc_id]`.
- `cent_pagerank`: generic "selected → filter" toggle (the deferred Tier 4 lens).
- `graph_status_inspector`: click a categorical attr value → `nodeAttrs[type][attr]` write (ping-pong risk — inspector re-renders under the new mask).

**Filter-aware refinements.**
- `ego_compare`: make intersection-only also respect `activeNodeMask` ("common alters that survive the filter").
- `graph_status_inspector`: "Hide filtered neighbors" toggle on the neighbor list.
- `timeline_node` / `timeline_edge`: mirror an `AttributeFilters` date-kind filter into `temporalFilter` — but only one path should be live to avoid brush ping-pong; prefer dimming the sidebar date slider when the attribute matches.

**Cross-panel preset / deep-link.**
- `connected_components`: accept "isolate these components" from `ego_compare` (each ego lives in one WCC).
- `ego`: accept "open ego with direction = X" from `edge_flow` arc clicks (needs a signal beyond the current selection broadcast).
- `cent_comparison`: two-way sync of `controls.logAxes` with the four single-centrality panels (sometimes useful, sometimes annoying).
