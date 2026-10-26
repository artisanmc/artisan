# Server registry and derived canvas

**Status:** draft — revised on 2026-09-25. Slices 1 to 3 implemented on the branch
`feat/server-canvas` (uncommitted), plus the automatic arrangement applied to project
boards (see "Progress"). Nothing on `main`.

## History

- **2026-09-22** — initial spec.
- **2026-09-23 → 24** — plan handed to Codex. It widened the scope to a "logical server
  + backend authority" foundation, then implemented everything in a single batch (P0A → P10, 341 files, existing
  routes replaced). Result judged mediocre: **abandoned**. The work is kept
  for reference on the branch `codex/server-registry-derived-canvas` (commit `011fd3fa`).
  ⚠️ This commit also carries unrelated WIP (billing, auth, docs-site, CI…).
- **Lesson learned**: no big bang. The target stays the same, but we build it **alongside**
  the existing code and only switch over once validated (see Delivery strategy).

## In short

**The target**: a single board per server, arranged automatically; a server registry that
groups all Documents by project, with its full-screen tab; search, translations,
data and resources global to the server. The per-project view does not disappear: it survives as a
**filter**.

> **The scope of the view is the server. The scope of storage stays the project.**

`Project` is not removed anywhere: it remains the folder, the unit of hash, publication, i18n
and transport. It only stops being a **place you enter**.

**The delivery**: we build the target on a **separate URL**, without changing the current views.
First visible slice = the general board **read-only**. The switchover (new default view,
old views removed) is the very last slice.

## Out of scope: logical server and backend authority

A **separate track, postponed**. It covers:

- a **logical server** that exists without a Minecraft server, that carries the projects and that unifies the
  personal / shared / demo cases;
- **backend authority** over contents, drafts and revisions, Minecraft only running
  a deployed copy;
- **explicit deployment** and explicit import of local changes.

**Why separate it**: it is the biggest and riskiest piece, and it overturns
`server-disk-only-storage`. Above all, the general board does not need it: it only
*reads* a server's projects, which the current endpoints already know how to do.

Reference for later: `docs/superpowers/plans/2026-09-23-backend-authority-and-logical-servers.md`
(written during the Codex attempt, **not validated**). When the time comes, it will have to be taken up
again as a proper spec.

**Consequence for this spec**: storage stays what it is today. Server projects live
on the Minecraft disk, hosted and demo projects in the backend. Everything that would assume
a single authority is either designed against this storage, or postponed.

## Vocabulary

⚠️ **None of these terms is in `CONTEXT.md`.** They come from a design session of
2026-09-05, which left only a memory note and no ADR in the repo. Debt to clear
by turning them into an ADR.

| Term | What it is |
|---|---|
| **Registry** | The panel that lists the Documents. Today it is the right rail, with its `MENUS` and `COMMANDS` sections, scoped to the project. In the target, it becomes **server-scoped and grouped by project**. |
| **Focus** | The view of a single Document (`…/document/$documentId`). It is its **mandatory home**: the full view, where everything is editable. |
| **Board** (canvas) | The graph view, with the rendered inventories and the navigation arrows. In the target, it becomes **derived** and server-scoped. |
| **Gutter** | The area of the board where the Documents that have no edge land. It is a first-class zone, not a dumping ground. |

## The problem

Today, opening a project puts the board in the middle of the screen. It is **created empty with the
project**, and the user is free to place their Documents on it or not. Two consequences:

- An empty board waiting is a room to furnish: it says that the project is unfinished
  as long as nothing has been placed on it. The pressure to use the board comes from its structure, not from a
  user choice.
- Manual curation is **always incomplete**. The proof is already in the code:
  `offBoardLinks.ts` and `GhostChips.tsx` exist only to display "this points to a
  Document you haven't placed".

And the finding that settles it: nobody will deliberately build a board by hand to
visualize menus they already know by heart.

## Decisions

### 1. `Project` remains the unit, but stops being a place

`Project` remains the folder, the unit of hash and publication, the i18n namespace, the scope of
assets, templates, models and captured items, and the unit of transport (`projectCopies.ts`,
`networkTransfers.ts`, zip export). None of this moves. It becomes a provenance badge and a
grouping axis of the registry.

**Why keep it**: an Add-on bootstraps its own project (for example `boutique_shop`), see
the `diskId` comment in `editor/src/domain/types.ts`. Without a project, the Add-on would pour its
files into the user's common pot.

### 2. The registry is server-scoped, the focus is the home

The registry lists all the server's Documents, groupable and filterable by project. The focus remains
the mandatory home of each Document. In the target, the landing is no longer the board.

### 3. The board is a derived view, not a composition

The graph is **already** derived: `deriveEdges(project)`
(`editor/src/features/canvas/deriveEdges.ts`) walks the entire project. Today, only
membership and position are manual. We remove membership: the board shows
**everything that exists** and arranges it automatically. It can therefore no longer be empty, nor lie.

`canvasLayout` stops being the list of members and becomes a **sparse map of
pinned positions**: only the nodes that the user deliberately placed appear in it.

`offBoardLinks` and `GhostChips` regain a real role: they only trigger when a
**filter** hides a target, hence after a deliberate choice.

**Direct editing kept on the board** (confirmed 2026-09-23). The focus remains the full
view. The read-only v0 is only a delivery step, not the target.

### 4. One board per server, filterable

Not one board per project, and no boards to build by hand.

- **Not one per project**: it breaks the graph exactly where it gets interesting. A core
  menu that opens a Shop menu would be a ghost chip on one side, an orphan on the other.
- **No boards to create**: nobody will do it.
- **"One per project" survives as a filter**, derived, storing nothing.

Filter axes: project, type, text. Their state lives in the URL, so that a filtered view can be
shared. Saved views (named filters) are a cheap v2, outside this effort.

### 5. Automatic board arrangement

A force-directed layout (d3-force, springs) scatters nodes in all directions. It makes them
overlap, because it reasons on points whereas a rendered inventory is up to
352×444 px. And it changes on every open. We therefore use a **layered** layout
(Sugiyama): it is deterministic, it takes the real size of each node into account, and it reads
naturally in the direction of navigation (command → menu → submenu).

#### What already exists and what we reuse

- **Node sizes**: `editor/src/features/canvas/menuLayout.ts`. A menu is `TEX_W` =
  **352 px** wide, and `34 + rows × 36 + 194` px tall, i.e. 336 px for a 3-row
  chest and 444 px for 6 rows. Fixed-height types (hopper, dispenser) go through
  `INVENTORY_TYPES[type].boxHeight`. `COMMAND_BOX` measures 140×48, `DIALOG_BOX` 140×60. `nodeBox`
  is already shared there by `Edges.tsx` and `GhostChips.tsx`. **The arrangement must read these same
  functions.** A second source of sizes would guarantee overlaps as soon as it
  diverged from the rendering.
- **Output format**: `Record<id, { x, y }>`, with `x, y` = **top-left corner** of the node. This is
  what `Stage` consumes today via `autoLayout(project)`, and what `nodeBox` reads. dagre
  returns **centers**: we must therefore convert (`x = cx − w/2`, `y = cy − h/2`), otherwise everything
  is off by half a box.
- **Arrow routing**: `routeEdges` (`edgeRouting.ts`) draws a Bézier curve from one box
  to the other. It also handles user-forced anchors (`canvasEdges`) and the spacing of
  anchors on the same side. **We keep it as is** and do not use the waypoints
  computed by dagre. Accepted limitation: a long arrow may cross an inventory. The
  crossing-minimizing order limits this case. Later we could route the curves through the dagre
  points.
- **What goes away**: `autoLayout` (which today only returns `canvasLayout`) and
  `gridArrange` (the "Arrange all" button, a 4-column grid).

#### What dagre does, and what it does not

`@dagrejs/dagre` computes the **layers** (network-simplex by default), the **order** within each
layer to limit crossings, and the **coordinates** while respecting real sizes.

It does **not** know how to:

- take **pinned positions** into account: it accepts no imposed coordinate;
- ~~start from an imposed order~~ — **wrong**: dagre 3 accepts order constraints within a
  layer (`layout(g, { constraints: [{ left, right }] })`, verified 2026-09-25). Reusing
  the order of the previous arrangement is therefore possible, if stability requires it;
- break cycles the way we want: it does, but arbitrarily;
- neatly lay out disconnected components.

All of this is on us, in the pipeline below.

#### The pipeline

A pure function, testable without rendering:

```ts
arrangeBoard(input: {
  nodes: { id: string; kind: "menu" | "command" | "dialog"; width: number; height: number }[];
  edges: { source: string; target: string }[];
  pinned: Record<string, { x: number; y: number }>;
}): Record<string, { x: number; y: number }>
```

**Step 1 — Nodes.** The Documents in scope, sorted by qualified id, with their sizes taken
from `menuLayout.ts`. Edges to a nonexistent Document are excluded: they remain
chips attached to their source.

**Step 2 — Partition.** We compute the connected components ignoring edge direction.
Nodes with no edge at all go to the gutter (step 6). Each other component goes
**separately** through dagre.

**Step 3 — Back edges.** We run a DFS from the roots of the component, that is the
nodes that nothing targets, sorted by id. A command is never targeted, so it is always
a root. In a component without a root (a pure cycle), we start from the smallest id. An edge whose
target is already on the DFS stack is a back edge: **we do not give it to dagre**.
`routeEdges` draws it anyway. This way, a "back to main menu" button never
pushes the main menu back by a layer.

**Step 4 — dagre, component by component.**

```ts
const g = new dagre.graphlib.Graph();
g.setGraph({ rankdir: "LR", ranker: "network-simplex", ranksep: 160, nodesep: 48 });
g.setDefaultEdgeLabel(() => ({}));
for (const n of sortedNodes) g.setNode(n.id, { width: n.width, height: n.height });
for (const e of dagEdges) g.setEdge(e.source, e.target);
dagre.layout(g);
// dagre gives centers → top-left corner
const pos = (id) => { const n = g.node(id); return { x: n.x - n.width / 2, y: n.y - n.height / 2 }; };
```

Layers as columns from left to right: commands form the first column, and each
navigation level adds one. `ranksep: 160` leaves room for the curves to pass between
two 352 px-wide columns. Both values will be tuned on real data in
slice 3.

**Step 5 — One component per row** (decided 2026-09-25). Components sorted by number of
nodes descending, then by smallest id, and stacked vertically from (40, 40) with
a 120 px gap. Each row is a journey read from left to right from its
entry point (`/menu`, `/dailyq`…). Replaces a shelf layout over 2,400 px, which placed
unrelated journeys side by side.

**Step 6 — Gutter.** 160 px below everything else, with no heading. The
Documents are laid out in rows, sorted by type (menus, dialogs, commands) then by id, with
a line wrap at 2,400 px.

**Step 7 — Pinned positions.** A pinned node **stays in the dagre computation**: its edges
keep structuring the layers of its neighbors. It is then placed at its pinned coordinate,
and **pinning a node where it already was moves nothing** (tested). Last pass: in the order
of their position (top to bottom), the automatic nodes that overlap a pinned node or an
already processed node move down until they find room. Implemented without backfilling: the room
that dagre gave the pinned node stays empty. A pinned node never moves. Two
pinned nodes may overlap (confirmed decision, see decision 6).

#### Stability: the board does not move on its own

**The problem.** dagre optimizes *globally*. Adding a single node then rerunning the computation can
reorder entire columns. If we insert locally during the session (decision 9) but
recompute everything on reload, the board **jumps on every refresh**. This is
exactly the loss of bearings we are trying to avoid.

**The rule.** The full computation only runs in two cases: **when no previous arrangement
exists**, or when the user clicks **"Rearrange"**. The rest of the time, the board
shows the previous arrangement, corrected locally:

| Change | Effect on the board |
|---|---|
| New linked Document | Local insertion next to its source (decision 9) |
| New unlinked Document | Appended to the end of the gutter |
| Document that gains its first edge | It leaves the gutter for a local insertion |
| Deleted Document | It leaves a hole, only backfilled by "Rearrange" |
| New edge between two already placed Documents | Nothing moves, the arrow is simply drawn |
| Size change (number of rows) | The nodes below, in the same column, are pushed if needed |

**Where the previous arrangement lives.** In a **per-user cache** (`localStorage`, keyed by
server), and never in the project files. This cache is disposable: if it is lost, a full
computation rebuilds a correct board. It does not decide *what exists*, only *where
it is displayed*. It therefore cannot lie the way the member list did.

Trade-off: two collaborators may see different arrangements, until one
of them clicks "Rearrange". For an arrangement that must be shared, the tool is the
pinned position, which lives in the files. *To be validated, see Open questions.*

#### Guarantees, and how to test them

| Guarantee | Test |
|---|---|
| Determinism without cache: same input → same coordinates | compute twice, shuffling the input order |
| No overlap between automatic nodes, nor with a pinned node | pairwise rectangle intersection, on fixtures up to 500 nodes |
| A back edge does not modify the arrangement | adding a "back" edge leaves positions identical |
| Orphans are in the gutter, below everything else | fixture with isolated nodes |
| A pinned node is never moved | fixture with pinned nodes in the middle of a column |
| Coordinates are top-left corners | `nodeBox(pos)` does cover the expected rectangle |

**Cost**: the Codex attempt measured 9 ms for 50 Documents, 11 ms for 200 and 22 ms for 500,
cold. Here, the full computation only runs on first open or on "Rearrange".

**Library**: `@dagrejs/dagre` (~100 KB). `elkjs` (~1.5 MB, with web worker) is only an
escape hatch if quality is not enough. It does accept an imposed order and arrow
routing.

### 6. We only persist pinned positions

The project files receive **only pinned positions**. Computed positions
are never written to the files: at most, they live in the user's disposable cache,
which serves display stability (see decision 5, "Stability").

- **Location**: in the `.artisan/editor.yaml` of the project **that owns the Document**, keyed
  by Document. Uninstalling an Add-on therefore also takes its positions with it.
- **Carrying over existing data** (confirmed): the old `canvasLayout` positions are kept
  **as is** and become pinned positions, which the user can release. Two
  old boards may bring overlapping positions: we do not move them silently, we offer to
  release them. The absence of overlap is guaranteed for automatic nodes, not between two
  user-imposed positions.

### 7. Draft and deploy: grouped on screen, separate per project on save

The draft indicator and the "Deploy" button become **server-scoped on screen**. The
diff is split by project, and a single project can be deployed on its own. On the storage side, each
project keeps its draft and its compare-and-swap. The server indicator is a **sum**, not
a transaction: a conflict in one project does not block the others.

### 8. Creation: two equivalent entry points, no imposed order

"Create at this spot" **loses its meaning** once the layout is derived. And "create from an
edge" cannot replace it: an edge is the *consequence* of a button that already points
somewhere, and a menu has N buttons that could all open the future menu. So we have two
entry points, with no hierarchy:

- **The registry**: we create a menu, a command or a dialog without linking it to anything. Each project
  group has its "+", so the owner is always explicit.
- **An action's target picker**: "+ Create a new menu" in the target choice of an
  `open_menu` or `open_dialog`. `ActionEditor.tsx` already knows `projectId`, `menuId`,
  `elementId` and `clickType`, so the owner and the link are established in the same gesture.

To this is added **repair**: when an `open_menu` targets a nonexistent id, the ghost chip
offers to create the target.

**Why no order is imposed**: the data already allows both half-states (a
reference that points to nothing, a menu that nothing opens). A UI that imposed a direction of
construction would contradict its own data layer. Consequence: someone who starts by
creating their menus will have, for a while, *all* their menus in the gutter. This is a normal state.

**Attachment is not a field.** A Document's project **is** its location on disk
(`projects/<diskId>/menus/<id>.yaml`). Moving a Document to another project therefore amounts to moving
files, with all their dependencies. This is out of scope, like selective export.

**Ids** (confirmed 2026-09-23):

- Document ids are **unique within the server**;
- new Documents receive an **automatic prefix** `menu_`, `cmd_` or `dialog_`. The
  dialog shows the fixed prefix and we type the suffix. The prefix applies to the file id,
  not to the label nor to the command text: `commands/cmd_boutique.yaml` can declare
  `/boutique`;
- existing ids are kept, and a collision is reported without implicit renaming;
- buttons remain identified within their menu, with an optional `btn_` prefix.

**After creation**: the **focus** opens on the new Document (confirmed).

### 9. Live: local insertion, never a full recomputation

An edit triggers a local correction of the arrangement (see the "Stability" table of
decision 5), animated over ~250 ms. For a new linked Document, we compute `rank(source) + 1` and
place it in the first free space of that column, or at the end of it. Only the nodes
below are pushed. The view moves
smoothly keeping the source visible, with no recentering or zoom. A **"Rearrange"** button
**releases all pinned positions** and reruns the full computation (Iban's decision on
2026-09-25: rearranging must really rearrange everything; Ctrl+Z restores the positions).

### 10. Full-screen Registry tab, a single host

The ~250 px rail cannot carry the grouping, the filters, the status and the bulk actions.
We therefore need a **"Registry" tab**, which will become the landing after the switchover. But above all not
two implementations: the repo got burned twice, with the first focus mode reverted, then
`SoloMenuStage` on 2026-09-05. The rule that came out of it is **"one rendering per Document type, and
as many hosts as there are distinct semantics, not one more"**. The rail and the tab do the same
thing, so it is **a single host** with a density prop. The rail will be collapsed by default, and
Cmd+K covers quick navigation. The "MY PROJECTS" list of the left sidebar then becomes a
registry filter; creating, renaming, importing/exporting and deleting projects
remain available in the registry.

### 11. All tabs move to server level, storage stays per project

| Tab | Server view | Storage (unchanged) |
|---|---|---|
| Search (Cmd+K) | index over all projects | `searchIndex.ts`: `Project` → `Project[]` |
| Translations | all keys, grouped by project | `lang/<lang>.yaml` per project |
| Data | Project sources + module sources | `data/<id>.yaml` per project |
| Resources | all assets, grouped by project | under the owning project |
| AI Assistant | stays on an **explicit target project**; writing to several projects will be the subject of another spec | — |

Each row shows **its provenance**, and each write is attached to an owning project.

### 12. A default project

A new server receives a `default` project **only once**. All projects can be
deleted, even the last one, and `default` is never recreated. An empty server offers "Create
a project" (confirmed 2026-09-23). As long as there is only one project, the registry shows no
group header.

Where does this bootstrap happen? Plugin, backend, or depending on the project type? The answer depends on the
storage track: **postponed** with it.

## Progress (2026-09-25, branch `feat/server-canvas`, uncommitted)

- **Slice 1** — `features/canvas/serverGraph.ts`: graph of the whole server, targets resolved
  across the whole server like the plugin's single table (`menus[menuId]`), an id not found or carried
  by two projects reported as an unresolved link.
- **Slice 2** — `features/canvas/arrangeBoard.ts`: steps 1 to 7 (pinned positions included).
- **Slice 3** — general read-only board, `…/servers/$serverId/canvas`
  (`features/serverCanvas/`), filters in the URL, link on the server page. No ghost
  chips: unresolved links are counted in the status bar.
- **Outside the "alongside" plan**, at Iban's request: the automatic arrangement replaces curation
  on the existing **project boards** (`projectBoard` in `autoLayout.ts`), with the
  "Rearrange" button. The old positions are kept as pinned positions.
- Not done yet: local insertion and stability cache (the board recomputes on every
  graph change), backfilling the holes left by pinned positions, releasing a
  single position.

## Delivery strategy

**Principle: alongside, not instead.** Each slice is delivered separately, and the
existing views do not change until the final switchover. Slices 1 and 2 are pure: they
touch no UI.

1. **Multi-project graph.** Qualified identity of Documents, and `deriveEdges` on `Project[]` while
   keeping the current signature. Tests: edge deduplication, nonexistent targets not
   converted into nodes, no collision between projects.
2. **Arrangement module.** `arrangeBoard`, a pure function that carries steps 1 to 7 of
   decision 5, with sizes taken from `menuLayout.ts`. Tests: the "Guarantees" table of
   decision 5. The local corrections of the "Stability" section come in slice 5.
3. **General read-only board, on a new URL** (for example
   `…/servers/$serverId/canvas`). It loads all of the server's projects via the existing
   endpoints. It reuses `Stage` with a read-only prop: no second host. A click
   on a node opens the existing focus in its project. Filters by project, type and text.
   Hard point: `Stage`, `nodeBox` and `Edges` are **single-project** today (they look up an id
   in a single `project`). They must accept a set of projects and qualified ids, without
   changing behavior for the existing views.
   **No existing view is modified. This is the first visible deliverable, to be validated on real
   data.**
4. **Pinned positions.** Moving a node writes into the `.artisan/editor.yaml` of the owning
   project. Carrying over the old positions. This is the first write of the new view.
5. **Editing on the general board.** Direct editing, creation via the registry and via
   `ActionEditor`, local insertion, "Rearrange" button.
6. **Server registry and Registry tab**: a single host, with a density prop, mounted on the
   new view.
7. **Global tabs** with provenance, then **grouped draft and deploy**.
8. **Switchover.** The new view becomes the landing and the old per-project views are removed.
   Only after validation **in game**.

## What does not change

- `lang/` and assets remain **per project**: i18n addresses are derived per project and
  locked by `I18nAddresses.kt` and `testdata/i18n-address-conformance.json`.
- Export and import remain project to project.
- The current storage (see Out of scope).

## Open questions

- **Per-user arrangement cache** (decision 5, "Stability"). The board does not move
  on its own, but two collaborators may see different arrangements as long as nobody
  has clicked "Rearrange". Alternative: recompute on every load, at the cost of a
  board that may jump on every refresh.
- **Creation in an Add-on's project.** Proposal from the Codex attempt: hide the
  "+" as long as no retention guarantee exists. The Add-on rewrites its own files,
  then calls `api.project.reload()`.
- **Name of the new URL**, and how to reach it until the switchover is done.
- **Global creation** when several projects are candidates: the filter's project? the last
  one used? `default`?
- **Selective export / moving Documents**: it is a transitive closure computation.
  Postponed.
- **Saved views** and **screen view** (HUD, bossbar, scoreboard): outside this effort.

## Code touchpoints

| File | Nature of the change | Slice |
|---|---|---|
| `editor/src/features/canvas/deriveEdges.ts` | `Project[]` variant with qualified ids, current signature kept | 1 |
| new `arrangeBoard` module (`features/canvas/`) | steps 1 to 7, pure function + adding the `@dagrejs/dagre` dependency | 2 |
| `editor/src/features/canvas/menuLayout.ts` | sole source of node sizes, reused as is | 2 |
| `editor/src/features/canvas/edgeRouting.ts` | unchanged: curves remain computed from box to box | — |
| `editor/src/features/canvas/autoLayout.ts` | `autoLayout` and `gridArrange` replaced by `arrangeBoard` at switchover | 8 |
| `editor/src/features/canvas/Stage.tsx` | read-only prop; no second host | 3 |
| new route `…/servers/$serverId/canvas` | general board | 3 |
| `editor/src/features/canvas/offBoardLinks.ts`, `GhostChips.tsx` | only trigger on filter | 3 |
| `editor/src/domain/types.ts` (`canvasLayout`) | member list → pinned positions | 4 |
| `editor/src/features/canvas/properties/ActionEditor.tsx` | "+ Create" in the target picker | 5 |
| `editor/src/features/search/searchIndex.ts` | `Project` → `Project[]` | 7 |
