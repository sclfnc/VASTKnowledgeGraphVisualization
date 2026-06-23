# The cross-panel contract

The single source for cross-panel behaviour. Every panel obeys it. Four contracts
(§1–4: bitmap-truth, mask-only, effective-type, Lock), then the reference material
they rest on: the filter slots, the selection caps, the upstream-write policy, and the
anti-patterns. A compliance checklist closes the page.

Per-panel specifics — what each panel reads and writes — live in the code:
`frontend/src/panels/` and the registry `index.js`.

## 1. Bitmap-truth (the three shared bitmaps)

Common state lives in two Pinia stores, `filters` and `selection`, exposed as **three
public bitmaps** that every panel consumes via
[`usePanelContext`](../frontend/src/composables/usePanelContext.js):

| Bitmap | Source store | Built in | Predicate |
|--------|--------------|----------|-----------|
| `activeNodeMask` | `filters` | `useFilteredModel` | `isActive(id)` |
| `activeEdgeMask` | `filters` | `useFilteredModel` | `isEdgeActive(edgeId)` |
| `selectedMask` / `selectedEdgeMask` | `selection` | `usePanelContext` | `isSelected(id)` / `isEdgeSelected(edgeId)` |

The contract is **"consume the mask"**, not "be internally a bitmap": a panel complies
if these masks drive its narrowing, however it stores its own data. No panel reads
`filters.*` raw to skip a mask; the only allowed raw read is showing the state of a
widget the panel itself edits (e.g. `ConnectedComponents` reads `wccFilter` to
highlight its Top-N button). Panel-private `controls` (log scale, top-N, bin size)
touch no bitmap.

Cross-panel influence is implicit: A influences B only if A writes
`filters`/`selection` and B consumes the resulting bitmap — which every panel does.
Today four panels write `filters.*`: `connectivity` (`wccFilter`), `degree` (`degree`,
via plot brush), `timeline_node` / `timeline_edge` (`temporalFilter`), plus
`AttributeFilters` (the sidebar editor). Everything else writes `selection`.

## 2. Mask-only

Derived quantities **must** stay anchored to the full graph; filters only dim the
marks. Two exceptions, by explicit design — both *count* views, where the point is to
see counts shift under a filter:

- `type_mixing` — recomputes matrix counts under `activeEdgeMask` client-side
  (Newman r stays full-graph);
- `edge_flow` — recomputes flow tuples `(src_type, edge_type, dst_type, count)` under
  `activeEdgeMask`.

`timeline_node` / `timeline_edge` are **not** exceptions: each bin ships its canonical
SoA indices and the panel counts `idx ∧ activeMask` per bin, so the timelines react to
every filter like any other panel.

Any new proposal that breaks mask-only MUST be raised and discussed as an issue
before any code is written.

## 3. Effective-type

When `schema.auto_promoted.{node|edge}` is non-null, the effective type is the
discriminator attribute, not the raw `Node Type` / `Edge Type`. Panels that group,
color, or chip-toggle by type MUST go through
[`useEffectiveType`](../frontend/src/composables/useEffectiveType.js). Filter writes
against the type chip group propagate to the effective set via `useFilteredModel`.

## 4. Lock (Isolation)

Per-panel full freeze. The snapshot holds the filters JSON, both selection arrays, and
clones of both active masks. While frozen, `usePanelContext` reads all derived state
from the snapshot until Unlock. Lock is the only per-panel freeze mechanism; it
replaced an earlier, weaker Pin mechanism.

## Filters

Slots live in `stores/filters.js`; mask construction lives in one place,
`useFilteredModel` (node mask first, then edge mask ANDed with it). The only
first-class editor is `AttributeFilters.vue` (mounted twice, `mode='node'|'edge'`, in
`GuideSidebar`): type chip group + structural section + per-type attribute accordions.

**Top-level slots:**

- `nodeTypes` / `edgeTypes: string[]` — allow-lists, effective-type aware. Empty
  `nodeTypes` = no nodes pass.
- `degree: {mode:'absolute', value:[lo,hi]}` — node-side range; the `%` toggle is
  UI-only. Edited from the sidebar slider and from a brush on the `DegreeDistribution`
  plot.
- `weight: {...}` — edge-side range, weighted graphs only. **NaN weights pass**
  (intentional: edges that lack a weight are not dropped).
- `hideIsolated` — drop degree-0 nodes. `hideSelfLoops` — drop `source === target`
  edges; shown when `schema.self_loops > 0`.
- `wccFilter: number[] | null` — component-id allow-list (0-based, size-desc,
  matching `/components/`); written by `ConnectedComponents`, no sidebar UI.
- `temporalFilter: {attr, scope, range} | null` — single brushed window from
  `ActivityTimeline`; applies only when `scope` matches the side being masked.

**Per-type attribute slots:** `nodeAttrs` and `edgeAttrs`, shaped
`{[type]: {[attr]: AttrFilterSpec}}`. Each type is an AND-chain: an item passes iff
its type has no entry or matches ALL of them. Spec kinds: `categorical {values}`,
`numeric/date {range}`, `boolean {value}`, and `text {query, mode}` for
high-cardinality identifiers, scanned client-side via `attrIndex.bitsetFor` — this is
what makes identifier-only types filterable.

No panel reads a filter slot back to recompute — they all see the trimmed mask.

**Filter history** (`filterHistory.js`): 20-entry debounced ring buffer, **filters
only**. Restore intersects the snapshot with the current schema's types. Undo/redo in
`GraphHeaderStrip`.

**Slots that don't exist on purpose:** `degreeDirection` (in/out/total), per-type
degree filter, `selectionAsFilter` (deferred — see the upstream-write policy below).

## Selection caps

Aggregate broadcasts MUST cap on write via `selection.replaceCapped(ids, cap)`: it
dedups, caps, and records `overflow` for the "+N more not selected" caption.

| Panel | Cap | Source constant |
|----------------------|------|-----------------|
| `type_mixing` | 100 | `SELECTION_CAPS.type_mixing` |
| `edge_flow` | 200 | `SELECTION_CAPS.edge_flow` |
| `connectivity` | none | cap (500) defined but **not applied** by design: a component click broadcasts all its active node ids, so the selection matches the filtered view exactly. |
| `ego_compare` (pies) | 4 | `MAX_LAYERS` (read-time slice) |

Any new aggregate-broadcast proposal must state its cap.

## Upstream-write policy

The four `filters.*` writers listed in §1 are the only ones today. A new upstream
write is a design decision: open an issue first. Decided guidelines:

- **Shift-click "lift to filter"** only where the gesture is easy to discover. Kept on
  `degree` bins (with a tooltip); dropped for `type_mixing` cells and `edge_flow` arcs.
- **Explicit "Filter to this" buttons** are the preferred pattern everywhere else.
- **Two-way attribute writes** (a panel writing a filter it also renders under) carry
  ping-pong risk: they need a guard and an issue flagged `[?]`.
- **Selection-as-filter is deferred**: Lock covers the freeze need. If a real request
  comes in, the path is a global lens toggle that ANDs `selectedMask` into every
  panel — not a new `filters.*` slot.

The concrete open proposals are tracked as issues.

## Anti-patterns

- **Two-way binding without a guard** — any bidirectional sync needs an
  `isLocalUpdate`-style flag (`ego` is the reference).
- **Bypassing `selection.replace`/`add`/`toggle`** — direct mutations break the
  store's invariants (string IDs, dedup).
- **Bypassing Pinia on `filters.*`** — every mutation must go through the store so
  `filterHistory` undo/redo sees it.
- **Capping via `replace` + manual `.slice()`** — use `replaceCapped` so `overflow`
  is tracked.

## Compliance checklist (adding or changing a panel)

- [ ] Narrowing is driven by the masks from `usePanelContext`; no raw `filters.*`
      read, except to show the state of a widget the panel itself edits.
- [ ] Metrics stay anchored to the full graph (mask-only); a new exception needs an
      issue first.
- [ ] Type grouping/colouring goes through `useEffectiveType` and the shared colour
      composables.
- [ ] Selection writes use `replace`/`add`/`toggle`; aggregate broadcasts use
      `replaceCapped` with a stated cap.
- [ ] New writes to `filters.*` follow the upstream-write policy (issue first).
- [ ] The panel behaves correctly under Lock (reads resolve to the snapshot).

