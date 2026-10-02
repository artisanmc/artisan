# Artisan — Domain Glossary

This file is the source of truth for domain language used in specs, code, and
chats. When a term in the codebase or spec drifts from a definition here, the
definition wins (or this file gets updated in the same change).

Terms are listed alphabetically. Each entry is a 1-3 sentence canonical
definition followed by examples and explicit non-examples where helpful.

## Action chain

An ordered sequence of **Steps** — each Step a leaf **action** (`give_item`,
`send_message`, `open_menu`…) or an `if` / `else if` / `else` branch over typed
**conditions** — that runs when something triggers it: an **Element**'s click, a
**Command** invocation, or a data-source `actions` field. `Step[]` in the domain.
Its canonical text serialization is the **Action DSL**.

A chain may **invoke** another chain stored on a **Data source** row/config
(`actions` field) via the `run_actions <expr>` action — the called chain runs
inline with the resolved-from row/config as its self-scope. Cf. ADR `action-dsl`.

Non-examples:
- A single **action** (`open_menu`) is not an Action chain — it is one leaf Step
  within one.
- A **condition** (`has_permission(vip)`) is not a Step — it gates an `if` branch
  inside a chain.

## Action DSL

The compact, indentation-based text language that is the canonical serialization
of an **Action chain** — one statement per action, `if …:` / `else if …:` /
`else:` blocks, `and`/`or`/`not` over typed condition atoms, `"literal"` or
`@key` for text. It is the on-disk and wire form (hand-writable in a data-source
`actions` field's YAML), not merely an editor view. Cf. ADR `action-dsl`.

Non-examples:
- The verbose structured tree (`{kind:"if", cases:[…]}`) is the *old* wire form
  the Action DSL replaces, not the Action DSL.
- An **Expression** (`balance >= 100`) is a value sub-language the Action DSL
  *hosts* in its condition atoms — not a separate statement language. It has a
  second, independent host: the **Template**.

## Appearance

How an **Element** looks and behaves in one situation: material/icon or image, title, lore,
count, the advanced item details, and the click **Action chains**. An Element
carries exactly one **display** — what it looks like when nothing else applies —
plus an ordered list of **states**, each guarded by an `if`. The first state whose
guard passes wins; when none does, the display renders. On the wire the display's
fields sit **directly on the Element** (`material:`, `title:`, `click:` …) and the
states live under `states:`. Cf. ADR `element-display-and-states`.

An image appearance uses a project PNG instead of an item. Its Element owns one
fixed rectangular footprint of slots, shared by all states; the image spans that
rectangle once and every covered slot invokes the same click Action chains.

A state is a **whole** appearance, never a patch: a field it omits is absent, not
inherited from the display. Two appearances of the same Element are therefore
independent — which is what lets a state turn a button into a barrier with no
title without having to un-say anything.

Non-examples:
- A state is not an override of the display. There is no merge, no partial
  application, no field-level inheritance.
- The retired `appearances: [<complete>, <complete>, …]` list is not an
  Appearance — it was the flat wire form of the same idea, dropped on 2026-08-17
  because nothing distinguished the fallback entry from the guarded ones. It is
  not read any more.

## Board group

A visual container on the canvas: each **Project** is the default outer group on the server-wide canvas. Its frame is hidden in the project's own view.
Within a Project, selected **Menus** can form one named, movable, colored
group; a Menu belongs to at most one manual group, with no nested manual groups.
Groups always remain expanded; their background uses the chosen color at 15% opacity.
Grouping changes only editor metadata, never Document files or runtime navigation.

## Bundle — **retired term** (2026-08-12)

A Bundle *was* the hash-keyed materialization of a **Project**, announced by the
backend (`bundle_available`) and downloaded by the plugin. The mechanism no
longer exists: the backend stores no Project content and never writes to a
server's disk, so there is nothing to publish, hash, announce, or fetch (ADR
`server-disk-only-storage`). A Project's files on the server *are* the Project —
there is no second artifact to name.

If you meet the word in code (`/api/v1/bundles`, `computeBundleHash`,
`BundleDownloader`) it is migration residue, not a domain concept. Say **the
Project's files** instead.

Still distinct, and still not Bundles:
- An **export** — a one-shot, portable zip of a Project made for sharing;
  importing it creates a **new** Project on the target Server, never live-linked
  back.
- The generated **resource pack** (textures/fonts served to players) — a build
  artifact derived from a Project's assets and delivered to the *player*, not the
  menu/command content the plugin reads.

## Captured item

A project-level entity holding a **full serialized ItemStack** captured from the
running game (via the editor's inventory mirror or an in-game command like
`/boutique additem`), plus a **display descriptor** derived generically at
capture time from vanilla components (base material, head texture, glint, count,
name — optionally enriched to a recognized custom ref like `nexo:<id>`). It is
the universal item value: referenced anywhere a material goes through the
`item:<id>` ref — the editor renders the descriptor, the plugin deserializes the
exact stack. A ref is **additive**: the item keeps its own name and lore, and
the referencing appearance layers over it (its title wins, its lore is appended
under the item's own lines). Cf. ADR `captured-items-and-module-field-kit`.

A model's **item value** may also be an editable object (`material`, optional `count` and advanced attributes), with a vanilla/custom/captured ref as its base. A menu binds this value through `item: "{item.icon}"` and adds its presentation over it; legacy Material expressions remain readable.

Non-examples:
- A **custom item** of the server catalog (Nexo/Oraxen entry reported by
  `CustomItemsManager`) is not a Captured item — the catalog belongs to the item
  plugin and is presence-reported; a Captured item is authored project content.
- The display descriptor is not the item — the opaque `stack` is the runtime
  truth; the descriptor exists only so the editor can draw a tile.

## Command

One of the three **Document** kinds: an admin-authored chat/slash command
(`commands/<id>.yaml`) — a trigger, typed arguments, and the **action chains**
that run when a player invokes it (`open_menu`, `send_message`, …). Its arguments
feed a **Menu**'s `contextInputs` by name. Commands are also a cross-module
composition mechanism: Modules register commands in the `CommandRegistry`
(`namespace:command`), the command-side mirror of **data sources**.

Non-examples:
- A button's `open_menu` **action** is not a Command — it's one step in an action
  chain; a Command is one of the things that *holds* such a chain.
- A raw Bukkit command from another plugin is not an Artisan Command unless a
  Module bridges it into the `CommandRegistry`.

## Config screen

A **module-declared editing surface**: a named entry under the **Module** in the
editor's sidebar that edits one of the module's files, **live against the
connected Server** (greyed out while the Server is offline). Declared as data
alongside the module's models and data sources — never coded; a module may
declare several (e.g. one per data type), and a module that declares models
without declaring screens gets a default "Données" screen. A screen offers two
modes over the same file — a generated **form** and the **raw YAML** — and a
declared schema is **optional**: without one the file is still editable, its
keys shown as literal fields (cf. ADR `yaml-assisted-editing`; the schema buys
labels, descriptions and constraints, it is not an entry fee).
Cf. ADR `module-config-screens`.

Non-examples:
- The canvas **Data panel** is not a Config screen — it is the *binding*
  surface (project-authored sources + the server-sources directory); module
  data is edited in Config screens, not there.
- A custom editor route a module ships as code is not a Config screen — Config
  screens are core-generated from declarations.

## Data model

A **named shape of data**: a recursive field schema (field name + kind — text,
localized text, number, boolean, item, list, object, **map** (key → value
dictionary), **enum** (closed value set), **discriminated union** (variant
chosen by a type tag) — nestable to any depth) that **Project source** content
conforms to. The `actions` and
`conditions` kinds always mean **Artisan's core engine vocabulary** (Action
chains, core conditions) — a Module never declares its own behavioural
variants; module-specific behaviour goes through the namespaced command
bridge. Unions are for **data** variants only. There is **one** type system:
the schema an Add-on declares and the schema an admin authors are the same
notion, differing only by **provenance** (mirroring Data source):

- **Module-declared** — namespace-qualified, arrives by declaration from a
  **Module** (reported at **Presence**, like data sources — never authored in
  the editor); its shape is read-only for the admin (the Add-on owns it).
  Declared models are **versioned**; their declaration ships **declarative
  migration steps** (a closed vocabulary of data transforms — never code) that
  the editor applies to conforming content; an evolution the vocabulary cannot
  express leaves the affected values **dangling** in the form (non-hermetic
  contract), never silently rewritten. Model evolution is edit-time only:
  source files carry their schema inline, so the runtime always reads data and
  schema that agree.
- **Project-authored** — created by the admin as content of a Project (the
  existing case).

Every **Table** source is a table *of* one Data model (creating a Table
auto-creates its model); a **Config** source may type its object fields with
one; a Data model may reference others (no cycles). The model also declares the
**Row key** field. Editing a model migrates the rows the editor owns
synchronously (add/rename/retype/drop fields); *consumers* of a changed field
(interpolations, Placements) are never rewritten — they dangle, per the
non-hermetic contract. The generated form derives entirely from the model; a field may carry a
small **closed set of presentation hints** (label, help, widget override,
section, master-detail) and a **closed validation vocabulary** (`required`,
`default`, `min`/`max`, `pattern`, `locked`) — both live in the model
declaration itself (same owner as the shape) and are invisible to the
runtime. Validation is **asymmetric**: blocking inside the generated form
(`locked` = read-only there), never blocking for hand-edited files — an
invalid or locked-but-changed value is *surfaced*, the runtime stays
tolerant. On disk a
project-authored model is `models/<id>.yaml` (lossless store); source files
stay denormalized and self-contained for the runtime — the plugin never
resolves model identity.

Non-examples:
- An **Item set** is not a Data model — the model defines the *shape* of a
  row's data; the set defines how a row *renders and behaves* in a Menu.
- A Minecraft item model (`items.json`) and an AI model are unrelated — hence
  the qualified name.

## Data source

A named, typed **provider** of data that menu slots, **Item sets**, and other
modules consume. One notion, two **provenances**:

- **Module-contributed** — keyed `namespace:source_id` (e.g. `shop:items`,
  `essentials:warps`), registered by a **Module** in the shared
  `DataSourceRegistry`. Data sources are the **composition mechanism** between
  Modules: a Module never calls another directly; it publishes data sources (and
  commands) and reads theirs. The same registry is how a thin **integration**
  Module bridges a third-party plugin (EssentialsX, LuckPerms) into Artisan — by
  contributing data sources, not by being a new kind of thing.
- **Project source** — keyed `pack:<id>`, authored by the admin as content *of a
  Project* (it lives in the Project's files on the server, and is
  exported/imported with it). Always **static**: its rows are hand-written, so
  the design-time set is by definition the authoritative set. A Project source
  is **one typed value** (ADR `bare-data-files`): a root **object** is consumed
  by interpolation (settings, constants); a root **list of a Data model** is
  iterable, placeable, and set-able, with a **Row key** (`key_field`, default
  `id`). What used to be the Table/Config shape split is now derived from the
  root kind — there is no stored shape. A root list additionally chooses its
  **file granularity**: the whole list in one source file, or **one file per
  row** (named by the Row key). Granularity is serialization only — consumers,
  iteration, and Placements are blind to it. A deeply structured per-file
  config (a quests category, a shop category) is a row of a root list whose
  model nests the depth. The source's **schema lives beside the data, never in
  it**: JAR declaration for add-on sources, `models/<id>.yaml` for
  project-authored ones (inline `fields:` is a legacy form, read forever,
  never written). On disk an **LText** value is the default language's literal
  text; other languages live in `lang/` under the **Key site** address
  (`sources.<id>.<rowKey>.<fieldPath>`). **MiniMessage** fields (single- or
  multi-line) are plain strings edited with a rendered preview; they export
  as ordinary strings.

The consumer side is provenance-blind: an Element, Item set, or Placement binds a
`SourceRef` and never cares who provides the rows.

Examples:
- The shop add-on registers `shop:items`; a menu's iterable slot pulls from it.
- An EssentialsX integration registers `essentials:warps` — that integration is
  just a **Module** whose job is contributing data sources, often with no editor
  surface of its own.

**Stability.** A data source is **static** or **dynamic** — a property the
registering Module declares. A **static** data source exposes a stable,
enumerable, finite row-set (its `fetcher(null)` returns the complete authoritative
set), each row identified by a declared **Row key**; the editor caches its
last-known snapshot so it can author against it offline. A **dynamic** data source
is runtime- or player-dependent and unbounded (auction listings, a player's homes);
it has no authoritative design-time set. The distinction gates authoring: a Menu
may **place** individual rows of a static source (see **Placement**), but may only
**paginate** a dynamic one.

Static constrains the **key-set**, not the values: *which* rows exist is stable and
enumerable at design time, but a row's field values (price, stock) may still resolve
per-player at runtime, and placeholders/conditions still tailor display and behaviour
per player. A Placement pins a **Row key**, never a resolved value.

Non-examples:
- A **Connector binding** (a menu slot's `source:` → `{ ref, params, filter,
  sort, limit }`) is **not** a data source — it's the *consumer-side reference*
  that points at one. Provider vs. reference: the data source yields the data, the
  binding selects and shapes it for one slot.
- A **Module** is not a data source; a Module *contributes* zero or more data
  sources (and commands).

## Dialog

One of the three **Document** kinds: an admin-authored dialog screen
(`dialogs/<id>.yaml`) — Minecraft's native dialog UI (title, body, inputs,
buttons), as opposed to the inventory grid of a **Menu**. A standalone document
with a stable id, living beside the Project's other Documents in its file tree.

Non-examples:
- A **Menu** is not a Dialog — a Menu is an inventory layout (slots/items); a
  Dialog is a text/form screen. Both are **Document**s, different kinds.

## Document

One of the three editable units a **Project** contains — a **Menu**, a
**Command**, or a **Dialog** — each one file on disk (`menus/<id>.yaml`,
`commands/<id>.yaml`, `dialogs/<id>.yaml`), edited as a standalone document with a
stable id. **Document** is the canonical umbrella, and code now matches: a Project's
`documentCount`, the `DocumentView` component, and the `.../document.$documentId`
route. (The CustomEvent `artisan:open_element` / `OPEN_ELEMENT_EVENT` retains the
legacy "element" name internally — Document is the term going forward.)

Non-examples:
- An **Element** (a button at a slot *inside* a Menu) is not a Document; it lives
  within one.
- A Project's translations and assets are not Documents — they are shared
  resources the Documents reference. They are still **files of the Project**
  (`lang/`, `assets/`): a glyph or a background is authored content, not a build
  artifact, so it lives on the server's disk with everything else (ADR
  `assets-on-server-disk`). The backend keeps no copy: no `assets` table, no
  volume — only a throwaway cache keyed by content hash.

## Draft

A named, private working copy of a **Project**, owned by a user and persisted in
the backend. Its Project determines the Network and Server; a user may have
several drafts for the same Project. It stores a file baseline, edited tree and
rename intentions. Saving a draft does not publish it: explicit publication
uses the plugin's file compare-and-swap. Browser copies are recovery backups.
An AI task will act on a user's draft through the same operations, with separate
publication authorization; there is no permanent shared "AI draft".

## Element

A single placed thing inside a **Menu**: a button/item/decoration occupying one
or more slot positions, carrying one **display** **Appearance** and any number of
guarded **states**. A Menu's layers each hold a list of Elements (`menu.layers[]
.elements[]`, domain type `Element`). The fundamental menu-building block on the
canvas — "you place Elements in a Menu."

The editor's **Buttons** panel offers game items, captured items and images to
place as Elements. **Resources** manages the Project's shared images and fonts.
An image's usages (`button`, `menu`) classify where it is offered, not separate
copies: one file may serve both uses. Menu images include backgrounds, logos,
frames and separators; they are positionable title layers, not clickable Elements.
Legacy `background` and `decoration` classifications both map to `menu`.

An Element's own keys are few and closed by habit — `id`, `positions`,
`iterates`, `places`, `states`, `tags` — because everything else at the top level
of an Element **is** a field of its display Appearance.

Non-examples:
- A **Menu** / **Command** / **Dialog** is a **Document**, not an Element.
- A slot **position** (an index like `13`) is not an Element; it's *where* an
  Element sits. One Element may span several positions.

## Expression

The closed sub-language that evaluates to a **value**: identifier and dotted path
lookup, indexing, a **closed method vocabulary** over lists and strings
(`join`, `pluck`, `length`, `first`, `last`, `at`, `contains`, …), limited
arithmetic, comparisons, ternary, and `%papi%`. Closed on purpose — no free
functions, no user-defined variables — so the editor can offer it as a form and
so every method can be documented, mirrored server-side and locked by a
conformance vector. Cf. ADR `expression-parity`.

Expressions have exactly **two hosts**: the condition atoms of an **Action chain**
(via the **Action DSL**), and the expression segments of a **Template**. They are
not a standalone artifact — an Expression is always embedded in something.

Non-examples:
- The **Action DSL** is a statement language (one action per line, `if`/`else`
  blocks). An Expression is one value, and appears *inside* it.
- The surrounding text of a lore line is a **Template**, not an Expression.

## Item set

How the rows of one Data source render as menu slots — the **Appearance**
(material/icon, title, lore, count) **and** click behaviour, with per-row
variation expressed through **states** guarded on row fields (never per-item
overrides).

An item set is **not an entity**: it is an Element carrying `iterates` (pagination)
or `places` (hand-pinned rows) plus its own display and states. It therefore
belongs to the Menu that renders it — two Menus showing the same source each own
their look, and editing one cannot silently change the other. Created from
« Données du menu » (`createMenuSet`), which seeds the display from the source's
schema.

Non-examples:
- The removed **Item template** (`ItemTemplate`, `templates/<id>.yaml`,
  `template/v1`, `iterates.template`) is not an item set — it was a project-level
  entity SHARED across menus, dropped on 2026-07-31 (ADR
  `item-templates-and-data-library`). A legacy file on disk is inlined into its
  consuming elements at import and never written again.
- The legacy `Project.templates` / `Element.templateRef` machinery is not an item
  set — that was an older, never-exported editor concept, also removed.
- A **Connector binding** (`{ref, filter, sort, limit}`) is not an item set — the
  binding selects *which rows*; the set defines *how a row looks and behaves*.
- An item set is not a Document — it cannot be opened as a Menu; it only renders
  inside the Menu that owns it.

## Key site

A single place in a project tree that holds an **LText** — e.g. a menu title
layer, an element appearance's title/lore, a `send_message` action's text, a
dialog input label. Each key site has a **canonical key** derived purely from
its position (`menus.<id>.elements.<id>.<state>.title`, `…click.left.message_1`,
`dialogs.<id>.title`). One traversal (`visitLTexts` / per-node `visitMenuLTexts`,
`visitStepLTexts`, `visitDialogLTexts`, …) enumerates every key site; reads
(usage labels, validation), key assignment (`rekeyProject`), minting, and release
are all folds over it.

Since 2026-09-30 (ADR `field-local-translations`) the canonical key is only the
editor's **in-memory bookkeeping** for structural text — on disk a structural
slot holds its own `{ <lang>: text }` map, not an address. An **action** text and
a data-source value keep the key-into-`lang/` contract.

Examples:
- A button's `send_message` text is a key site; its canonical key is
  `commands.give.message` (or `…message_1` for the second message in the chain).

Non-examples:
- A material/icon id, a slot index, or a numeric `x`/`y` offset is **not** a key
  site — it carries no translatable text.
- The translation **value** (`"Buy now"` in `en`) is not the key site; the key
  site is the slot the value is filed under.

## Link

The **act of binding a Server to its credential**, always initiated from the
editor: a logged-in user adds a Server to a **Network** on the web, which creates
the Server row (keyless — `hash` NULL until redeemed) and prints a **link code**;
the admin runs **`/artisan link <code>`** on the Minecraft server, which redeems
the code for the Server's **key** (minted at redeem time), writes it to
`config.yml`, and connects. Re-issuing a code for an existing Server and
re-running `link` **rotates** its key in place — same Server row, same Projects,
no duplicate key. Ownership afterwards moves only via a Network **transfer**.
See `docs/decisions/editor-first-server-linking.md`.

Non-examples:
- A **transfer** is not a Link — transfer moves already-owned things between
  owners with its own safeguards; Link binds a Server to its key.
- "Claim" / "setup" are not canonical — domain and code say Link
  (`link_codes`, `/artisan link`, `POST /link/:code/redeem`). The old WS pairing
  (`/artisan setup`) and web `claim` flow were removed 2026-07-15.
- Post-link, `/artisan editor` printing the Server deep-link is not a Link — the
  binding already exists; the command is informative only.

## LText

A reference to a localizable string. On disk (ADR `field-local-translations`,
2026-09-30) a **structural** slot — menu title, appearance title/lore, dialog
title/body/label — holds either a bare string (the default language's literal,
or a `{i18n:key}` ref) or a field-local `{ <lang>: text }` map, so a Document
carries its own languages. An **action** text (inside the Action DSL string) and
a **data-source** value still use a stable **key** into the project's `i18nKeys`
map. The editor's in-memory domain carries the LText (the key), never the
resolved string — resolution happens at render/export against the active
language with a fallback chain. A fresh domain LText is minted with a random
provisional key (`lt_<rand>`); canonicalization to a semantic key happens lazily
at the deploy/export/persist boundary, not per edit.

## Membership

A user's belonging to a **Network**, carrying a **role** that scopes what they may
do there. Two roles exist: **owner** (governance — billing, transfer,
Network deletion, member management, key rotation) and **member** (full editorial
access to every Server and Project of the Network, nothing destructive at Network
level). Roles are per-Network: the same user may be owner of one Network and
member of another. The role set is expected to grow — owner/member is the current
vocabulary, not a closed law.

Non-examples:
- A Membership is **not** per-Server or per-Project — access is granted at
  Network granularity (finer ACLs are deliberately out of the domain today).
- The owning user is not the Network; see **Network**.

## Menu

A single inventory layout (rows × cols, default 6×9 chest) plus all of its
content: slots, conditional logic, click action chains. **One menu = one
editable document** identified by a stable id (e.g. `shop_main`). Pagination
is a runtime concern of certain slot kinds within a menu — it does **not**
mean "page 1" and "page 2" are separate menus.

Examples:
- `shop_main` is one menu. Its 4 pages of items are runtime states of the
  same document, navigated via in-menu nav slots.
- `category_armor` is a separate menu (different layout, different click
  handlers). Switching between `shop_main` and `category_armor` happens via
  the `open_menu` action.

Non-examples:
- `shop_main_page_2` is **not** a menu name we generate. There is one
  `shop_main` that paginates internally.

## Navigation history

The per-player LIFO stack of screens (**menu** or **dialog**) a player moved
through. Opening a screen (`open_menu` / `open_dialog`) pushes the screen being
left; the `open_previous_menu` action pops the top and re-opens it without
pushing the current one — so the stack shrinks on every back and two screens
cannot ping-pong forever. Cleared when the player quits, not when a menu closes
(closing is how every navigation shows the next menu).

Exposed to templates as `{has_previous_menu}` (boolean, guard a back button) and
`{previous_menu.id}` / `{previous_menu.title}`.

_Avoid_: browser history, breadcrumb (this is a stack, not a path).

## Module

A **capability** of the platform — one coherent vertical of functionality
(menus, commands, translations, dialogs, shop, quests…) built in three symmetric
layers: plugin (`ArtisanModule`), backend (`BackendModule`), editor
(`FrontendModule`), wired through a `ModuleRegistry`. A Module is the *logical*
unit of capability, deliberately distinct from the artifact that ships it.

Two families, split by **distribution**:
- **Core module** — bundled in the core Artisan JAR, always present (menus,
  commands, i18n, dialogs). Installing Artisan gives you every core module.
- **Add-on module** — distributed separately (its own repo + a Paper plugin JAR
  that `depend`s on Artisan), optional, switched on per **Server** by **Presence**
  (shop, quests, kits).

Whether an Add-on is free or paid is an **orthogonal** property — not part of what
makes something a Module.

An Add-on that ships default content owns a **dedicated Project** (one per Server):
its working-copy lives in the **Add-on's own plugin dir**, not the core
`projectsDir`, and the editor surfaces it under an **Installed modules** section
rather than the flat project list (ADR `addon-owned-project-roots`). Consumption
stays server-global — a menu in *any* Project can consume the Add-on's **data
source** — while its default content is centralised in that one Project. An
Add-on's richer config is authored through its **Config screens** — declared,
core-generated forms over its declared **Data models**, edited live against the
Server (ADRs `composable-data-models`, `module-config-screens`).

Non-examples:
- A **plugin JAR** is not a Module — it is the *vehicle* that delivers one. An
  Add-on is *shipped as* a Paper plugin; the Module is the capability inside, not
  the JAR. (Artisan itself ships as a plugin, yet is the host, not a Module.)
- **Presence** (a Module being active on a given Server) is not the Module; it's
  the runtime fact that the Module is installed and connected there.

## Network

A group of **Servers** under one ownership/team — the unit of ownership, access
(**memberships** with roles), billing (a paid **Plan version**), and handover (**transfer**).
**Not** a Minecraft proxy topology: a Network is who-owns-what, not which servers
sit behind a proxy (the two often coincide but needn't). A User may belong to
several Networks and a Network has several members — so a Network is **not** a
User/Account, but the shared container they have access to.

Non-examples:
- A Bungee/Velocity proxy cluster doesn't define a Network — ownership does;
  Artisan never sees the proxy topology.
- The owning **User** is not the Network; users are *members* of Networks.

## Plan and entitlements

A **standard plan** is a code-managed commercial offer with a stable key (`free`
or `pro`). Its billing interval and version identify immutable conditions;
database and payment-provider IDs are environment-specific references.
A **custom offer** is an independent copy of standard conditions, managed in the
admin console and private to one Network. A draft grants no access; publishing
makes the offer available to its intended Network, subject to payment readiness.

A **Plan version** fixes price, billing and credit cadence, limits and capabilities.
Changing published conditions creates a successor; existing subscribers retain
their paid version. Billing cadence and credit cadence are distinct: standard
annual Pro is paid yearly but grants credits monthly.

**Entitlements** are a Network's effective limits and capabilities, resolved from
an active **manual assignment**, otherwise its confirmed paid version until expiry,
then from Free. A manual assignment grants a published plan's full rights and
recurring credits without payment, optionally until a fixed date. Features check these
rights rather than a plan name or the denormalized `tier` flag. A null limit means
unlimited; zero means no allowance.

## Placement

An authored pin of **one row** of a **static Data source** — referenced by its
**Row key** — onto **one slot** (on a given page) of a **Menu**. Placements are the
**placement mode** of an iterating **Element**: the alternative to **pagination
mode**, where instead of auto-filling a slot range in source order, the admin
decides exactly which row sits where — and, in a multi-page layout, on which page.
Paging reuses the same in-menu navigation as pagination mode; only the page/slot
assignment is hand-authored rather than computed. A Placement pins **position
only**: everything about how the row looks *and behaves* (material, title, lore,
click chains) comes from the Element's own **Appearance** — there is **no
per-placement override**; per-row variation is a guarded **state**. Available only on **static** sources (a **dynamic** source has no stable
design-time set to place against).

On a **parameterised** Menu — one whose source is filtered by an input, so that the
single document serves many screens — the Element holds the Placements of **every**
context at once, and a given slot therefore has a different occupant per context.
This is not a collision: the filter means only the rows of the current context exist
when the Menu renders, and a Placement whose key matches no row simply leaves its
slot empty. It does mean the Placements of a parameterised Menu are only legible
through a **Preview context** — read without one, they look like a pile of
conflicting pins.

Non-examples:
- **Pagination mode** is not Placement — pagination auto-lays a whole list into a
  slot range in source order; Placement is hand-authored row-to-slot pinning.
- A Placement's `cachedDisplay` (the row's last-known name/icon/lore, kept so the
  slot still renders offline) is not the source of truth — the live source wins
  when reachable; the cache is a render fallback bounded to placed rows.
- A "special-looking" placed row is **not** an override — it's a conditional
  appearance state of the Element, or, if genuinely bespoke, a normal hand-placed
  Element instead of a Placement.

## Presence

The **observed** runtime state of a **Server**, reported by its connected plugin
over the WS link — not something authored in the editor. It answers "what is
actually live on this server right now?": at minimum whether the Server is
**online** (≥1 plugin instance connected) and **which Modules** are installed
there (`installed_modules`). The live connection is the source of truth; the
editor reads a persisted projection of it (`server_modules` rows + an `online`
boolean) to gate which UI to show.

Examples:
- The Quests add-on appears in the editor only when the Server's Presence
  includes the `quests` module — "installed on the server → visible in the editor."
- A Server reads as online the moment one instance connects; how *many* instances
  are connected is not surfaced (Presence exposes a boolean, never a count).

Non-examples:
- **Authored config** is not Presence — Presence is the live mirror, config is the
  declared intent. A Module may be configured for a Server yet absent from its
  Presence (not actually installed), or installed yet unconfigured.
- The **server key** is not Presence — the key is the durable credential; Presence
  is the transient "is it connected, and with what" fact that the key's instances
  report.

## Preview context

The set of **inputs** under which a **Menu** is being looked at in the editor. A
Menu that declares inputs (a category id, a target player…) renders nothing on its
own: the same document is one screen per context, so the editor must be told which
one to show. The candidate contexts are **derived from the Menu's call sites** —
every `open_menu … with …` that reaches it, i.e. the same fact the board already
draws as an **edge** — so adding a caller adds a context without anyone declaring
it. The chosen context drives what the canvas renders, which rows the **Placement**
tray offers, and nothing else.

Non-examples:
- A preview context is **not** part of the Menu — nothing about it is stored in the
  document, and two people editing the same Menu can look at different contexts.
- **Preview as player** is not a preview context — that picks whose runtime data is
  resolved (permissions, balances); a preview context picks which *screen* of a
  parameterised Menu you are on. They compose.
- A **Call site** is not a preview context — the call site is the authored link
  (`open_menu … with …`); the preview context is the editor standing in one.

## Project

**Storage (revised 2026-09-27, ADR `server-only-projects`):** every account
Project belongs to a **Server**, linked or not; account-owned hosted projects are
retired. Published content lives on the server disk; private **Drafts** and
**Versions** live in the backend, and the editor shows the server's current
**Snapshot**. A Project on an unlinked Server has no published content yet — only
drafts — until its first publication. A temporary demo belongs to its DemoSession,
without a fake User, Network or Server; it is disposable and leaves only through
export.

The editable collection of GUI content — its **Menus**,
**Commands**, **Dialogs**, translations, and assets. A Project is a tree of files
on its owning disk: Minecraft server or durable backend volume. That disk is the
authority for published content; publication is explicit. A text editor
can still edit server files directly. The web editor is a client of the project's
files (cf. ADR `files-first-source-of-truth`). A Project belongs to
**exactly one Server**.
A Server holds **one or more** Projects. The Project is
the granular unit of organisation *and* of **portability**: a server's content is
split into Projects so each can be exported, shared, and imported independently.
ZIP export is available everywhere, demo included; ZIP import is withdrawn
until it can target a Server. Projects are never live-linked to one another.

A Project has **two identifiers, and only one of them is global**. Its *disk id*
is the directory name the owning server uses, and it is unique **per server**
only — an Add-on bootstraps the same one everywhere it is installed, so
`boutique_addon` names a different Project on every server that runs the Boutique
Add-on. Its *internal id* is unique platform-wide and is what the backend rows
address. Editor URLs use the exact folder/module ID within a Network + Server
(server Projects) or the current DemoSession. The
internal ID remains the key for drafts, history, relationships and content APIs.
Renaming changes the public folder ID, never that internal key. Old slugs and
completed rename sources resolve only when unambiguous in the location; current
folder IDs take precedence. Treating a disk id as global is what let one
server overwrite another tenant's Project (2026-08-12); see
`docs/architecture/entities.md` § `projects.externalId`.

This is the **canonical** domain term, and code/DB/API/UI **now all say `project`**
(`projects` table, `projectId`, `createProject`, `/projects` routes, `project_id` /
`project_hashes` WS fields, the `plugins/Artisan/projects/` disk dir, and the
editor UI). It was historically called **`pack`** in code/DB/API and labelled
**"Workspace"** in the UI; the 2026-06-18 full-stack rename brought every layer onto
`project`. "Pack" was rejected as the domain word because it collides with Artisan's
own generated **resource pack** (and the Minecraft "texture pack" reflex);
"Workspace" was rejected because it connotes the editing *environment*, not the
*content* itself.

Non-examples:
- The generated **resource pack** (textures/fonts served to players) is **not** a
  Project — it's a build artifact derived from a Project's assets.
- A single **Menu** is **not** a Project; it is one Element within a Project.

## Row key

The field a **static Data source** declares as the stable unique identifier of each
row (`keyField` in the declaration; for a **Project source** it is declared on the
**Data model**, so two Tables of the same model share it). It is the anchor a **Placement** pins to — so a
placement survives the row-set being reordered, and a row removed while the server
was offline surfaces as a **dangling** placement rather than silently rebinding to a
neighbour. Only static (placeable) data sources need a Row key; a purely paginated
dynamic source does not.

Non-examples:
- A **Key site** is unrelated — that is an i18n concept (where an **LText** lives).
  A Row key identifies a data row, not a translation slot.
- A slot **position** is not a Row key — position is *where* a Placement sits; the
  Row key is *which* row it pins.

## Root

A directory a **Module** declares as editable from the editor. Its *kind*
decides what the files inside are worth, and the Module chooses by deciding
where to put them (cf. ADR `yaml-assisted-editing`):

- A **project root** holds a **Project** — its files are versioned, survive the
  server, can be edited while the server is offline, and carry translations in
  their own `lang/`. It may live inside the Module's own plugin directory, so
  "versioned" never means "moved into Artisan's folder".
- A **plain root** is any other declared directory (typically a plugin's own
  config): editable live against the Server, with no history, no offline
  editing, and no translations of ours — its content is consumed by its owner,
  so its wording is its owner's business.

Non-examples:
- A **Project** is not a root — it is what a project root *contains*.
- An arbitrary server path is not a root: a root is **declared** by a Module
  that accepts the consequences (knowing when to reload, owning the files).

## Server

A single Minecraft server within a **Network** — what **Projects** attach to and
deploy onto. Identified and authenticated by its **key** (a rotatable bearer
secret, hashed in the `server_keys` row); code/DB call the entity `server_key` /
`serverKeyId`. A Server belongs to one Network and holds one or more Projects.

The **key** is the Server's *credential*, not the Server: rotating it — or running
several plugin instances on one key — leaves the same Server. Whether a Server is
**online** (≥1 instance currently connected) is its **Presence**, a runtime fact,
not part of the entity.

A Server is **unlinked** until `/artisan link` redeems its key: it exists in its
Network and can hold Projects made of drafts only, prepared before the plugin is
installed. Linking changes nothing about those Projects; their first publication
creates their folders on the disk.

Non-examples:
- The bearer secret is **not** the Server; it's the credential. Rotation swaps the
  secret, same Server.
- A connected plugin process is a runtime *instance* of the Server, not a separate
  Server (instances may share one key).

## Snapshot

The files a server Project's plugin loaded at its last start or `/artisan
reload` — what the server runs. The editor shows the Snapshot, not the live disk.
_Avoid_: bundle, live files

Non-examples:
- A hand edit on the server disk is **not** in the Snapshot until the next reload.
- A **Draft** is never a Snapshot: it is unpublished work.

## Version

A recorded state of a server Project: every **Snapshot** that differs from the
previous one, with its date and author (the user
who published, or the server itself after a hand edit and reload). Versions are
browsable per file or for the whole Project. Restoring one never publishes: it
loads that content into the user's **Draft**, which is then published normally.
_Avoid_: commit, backup, trash (the retired on-disk `.artisan/history/`)

Non-examples:
- Several hand edits between two reloads form a single Version.
- A Draft autosave is not a Version; only what the server loads is.

## Template

The text form of every player-facing string authored in the editor — an item name,
a lore line, a menu title. A Template is a sequence of segments: literal text,
`{i18n:key}` references, and `{`**Expression**`}` segments, rendered in one pass to
the final string a player sees. Interpolation of a Data source row's fields
(`{quest.name}`) is the everyday case; a method call
(`{rewards.pluck("name").join("\n")}`) is the same mechanism.

A Template is rendered **identically by the editor's preview and by the server** —
that equality is the contract, not an implementation detail, and is what makes the
preview trustworthy. Cf. ADR `expression-parity`.

Non-examples:
- MiniMessage markup (`<gold>`) is *styling* applied downstream of Template
  rendering, not a Template segment.
- A **Data source** row field carrying `"34/64"` is a plugin pre-formatting its
  data; the point of Templates is that the menu composes that itself.
