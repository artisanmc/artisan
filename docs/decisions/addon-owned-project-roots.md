# Add-on-owned project roots + Installed-modules grouping

**Status:** accepted (2026-07-22)

## Context

The boutique Add-on's content lives in a dedicated Project (`boutique_shop`) that
(a) sits in the core's `plugins/Artisan/projects/` dir and (b) appears in the
editor's flat project list — giving no signal that it is Add-on-owned content, and
no clean-uninstall story. The owner flagged both.

Two things initially suspected to need fixing turn out not to. **Consumption is
already server-global**: an Add-on registers its data sources in the runtime
`DataSourceRegistry`, so a menu in *any* Project consumes them — the idiomatic
pattern of `modules.md §4`, not a defect. And the **catalog format** — whether an
Add-on's config is authored via a bespoke form or a generic schema-driven editor —
opened a far larger question (a composable-schema + form-generation system that
reuses core kinds like the Action DSL). That larger question is deliberately **split
off** into its own design track
(`docs/superpowers/specs/2026-07-22-composable-config-schemas-and-forms.md`, to be
grilled later). This ADR captures only the small, separable, decided slice.

## Decision

1. **Add-on-owned Project root.** An Add-on's Project working-copy lives in the
   **Add-on's own plugin dir** (`plugins/Boutique/`), not the core `projectsDir`. The
   core gains a `projectId → root dir` resolution: an Add-on **registers its root** at
   `onEnable` via `ArtisanAPI`; `ProjectReader`, `BundleDownloader` (write +
   delete-sweep), `BundleHasher`, `ProjectDeleter`, and hot-reload all operate **per
   registered root**. The default root (core `projectsDir`) still owns user-created
   Projects. The `.artisan-trash/` / `.artisan*` filter rules apply per root.
   Uninstalling the Add-on removes its Project with it. *Rejected:* keeping the
   working-copy in the core `projectsDir` — simpler, but no clean-uninstall and no
   physical ownership; the owner chose ownership.

2. **Editor "Installed modules" grouping.** The Add-on's dedicated Project surfaces
   under an **Installed modules** section (presence-gated on `server_modules`), not the
   flat project list — signalling it is Add-on content, editable but owned by the
   Add-on.

3. **The boutique is otherwise unchanged, for now.** Its bespoke editor,
   `boutique/shop.yaml` (`boutique/v1`), `boutique:items` data source,
   `/boutiqueadmin additem` flow, and captured items stay exactly as shipped,
   co-located in the one Project (so menu `item:` refs resolve as today). Rebasing the
   catalog onto a schema-driven format — and giving `name`/`lore` i18n — belongs to
   the deferred design track, not here.

## Consequences

- Small and self-contained; unblocks nothing else and touches no data format.
- The one genuinely new capability — Add-on-owned Project roots — benefits every
  future Add-on that ships default content.
- Supersedes only the disk-location shortcut noted in `modules.md §15`. The "catalog
  as generic Data models" and field-contract ideas explored earlier this session are
  **not** adopted here — they move to the deferred track.
- No prod data migration (the boutique format is untouched).

### Amendement 2026-07-31 — le masquage d'une racine core est signalé

Quand un Add-on enregistre `<id>` alors que `plugins/Artisan/projects/<id>/`
existe déjà, la racine enregistrée gagne et la copie core devient invisible :
plus lue, plus hashée, plus synchronisée, plus scannée. Le passage à cet ADR a
laissé exactement ça sur le serveur de dev — un arbre `boutique_shop` figé au
2026-07-25, avec un `.artisan-sync.yaml` déjà divergent.

Ce n'est pas un déchet inerte. Le jour où l'Add-on échoue à démarrer, personne
n'enregistre la racine, `ProjectRoots.all()` réexpose la copie périmée comme
project vivant, et la bannière de divergence — **dont le défaut est « disque »**
— propose de la pousser par-dessus la vraie.

`ProjectRoots.register` émet donc un WARN nommant les deux chemins. Un log, pas
un refus : l'Add-on a le droit de posséder sa racine, c'est la copie orpheline
qui doit disparaître, et seul l'admin peut en décider.

### Amendment 2026-09-12 — resolved identity and durable rename

`register(projectId, dir)` remains the permanent stable API for add-on identity,
independent of the directory name. Ordinary projects use their directory name.
`ProjectReader` now consumes the resolved map key in both cases; legacy manifest
`project_id` is readable but ignored with a warning when divergent, and is no
longer serialized. Boutique registers `boutique_addon` at the existing
`plugins/Boutique/editor/` directory; its module and data namespaces stay unchanged.
Presence reports ownership, including add-ons registered after initial connection.

Ordinary project rename uses an operation ID, a journal and hidden staging under
the core `.artisan-renames/` directory. Recovery precedes runtime discovery;
an interrupted operation with a conflicting destination isolates its two roots
without preventing unrelated projects from loading. File, asset, config writes
and deletion share the rename lock. Private history and drafts move with the tree;
the transient operation marker is excluded from ordinary reads and writes.
The backend reconciles confirmed operations before discovery to preserve its
immutable project anchor. Add-on roots cannot be renamed through this channel.

Phase 2 limitation: historical source names remain reserved against stale writes,
including `create: true`; renaming back to a previously used name returns
`destination_reserved`. Case-only rename is supported with the new exact spelling.
Safe name reuse requires a later lifecycle generation carried by every writer.
