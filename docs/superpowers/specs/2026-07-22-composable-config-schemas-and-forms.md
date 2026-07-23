# Composable config schemas + schema-driven forms for Add-ons

**Status:** exploration — design track, **NOT yet grilled/locked** (2026-07-22).
Raw material for a future grill-with-docs session. Narrowed out of ADR
`addon-owned-project-roots` (which kept only the disk-placement slice).

> **Vision upgrade (2026-07-23)** — this track is no longer a boutique/quests
> side-quest: it is the **centerpiece of the "Artisan as a configuration
> framework" vision**. Artisan = the standard that solves config
> standardization for Minecraft plugins (menus, i18n, actions, data) + a web
> editor on top; the goal is that **any plugin can migrate to the standard**.
> Adoption is **by declaration, never by code**: a third-party plugin declares
> schemas / data sources / commands / its own project root and gets the editor
> for free — it never ships code that runs in Artisan's editor or backend.
> This *reopens* third-party support (dropped 2026-06-17), which died because
> it required third-party *code* in the SaaS; declaration-based adoption
> removes that blocker. Enabler chain: files-first canonical format (ADR
> `files-first-source-of-truth`) → composable schemas (this track) → form
> generator → any plugin's config. The hard questions (schema contract
> stability, expression sandboxing, standard versioning, hosting of
> third-party-owned projects) belong to this track's future grill.

## Why (the missing primitive)

Two Add-ons force the same gap:

- **Boutique** — a curated categories→items catalog. The generic Data-model *Table*
  UI is ergonomically wrong (items shown mixed across categories, nested `model`-ref
  buggy), and item `name`/`lore` are monolingual.
- **Quests** (MSQuests, to be integrated) — a `daily.yml` category file is a deeply
  structured document: scalars + **enums** (`strategy`, `flow`, `actor_type`), **maps**
  (`tiers`, `tier_distribution`, `actions`-keyed-by-event), **lists of nested objects**
  (`quests[] → stages[] → objectives[]`, `rewards[]`), and **discriminated unions**
  (each action `{type: message|title|boss_bar|command}` with optional `conditions[]`).

Flat "Tables of rows" cannot express this. The owner named the fix precisely:
**define reusable schemas/models, compose them freely into documents, and let the
schema drive form generation** — the real form-generator *multiplier* of
`modules.md §8`, generalized well beyond today's Table/Config.

## Target primitive (to be grilled)

A composable schema/model system + a schema-driven form generator: an Add-on declares
its config shape and gets a web editor for free.

Type-system gaps vs today's Data models (object/list/model-ref/scalars, Table/Config
sources, `data/v1` export, `pack:` resolution, i18n Key sites — ADR
`project-sources-and-data-models`):

- **map / dictionary** (key → model)
- **discriminated union / polymorphism** (variant selected by a `type` tag)
- **enum**
- **model reuse that actually works** (current `model`-ref is buggy)
- **documents beyond Table/Config** — a file as one instance of a rich model,
  one-file-per-instance, with author control over granularity
- **a real form generator + a UI-schema layer** — layout/ordering/collapse/master-detail
  (the boutique category sidebar; the quests per-event action editors)

## Reuse of core kinds (a primary goal)

The quests `actions:`/`conditions:` blocks are almost Artisan's **Action DSL +
condition engine** already; `item` / ltext / minimessage recur too. The system should
let an Add-on **reuse core kinds** inside its schemas — Action DSL steps, conditions,
and the MC field kit (`material`, `item`, `minimessage`, `actions`) of ADR
`captured-items-and-module-field-kit` — while still declaring Add-on-specific union
variants (`boss_bar`, `objective_template`). This is the "réutiliser dans nos fichiers"
the owner wants, and the unification goal (owner confirmed 2026-07-22).

## Format ownership — recommended direction (confirm in grill)

**B — Artisan owns serialization; the Add-on owns the schema/shape.** The dev composes
models/documents freely (nesting, maps, unions, reuse, UI hints); Artisan owns the
on-disk serialization (a generalized `data/vN` in the Bundle), so i18n (Key sites +
`lang/`, resolved at bind), versioning/commits, `pack:` consumption, and the field kit
all come **free**.

*Rejected direction A* (Add-on keeps its native files, Artisan edits them in place):
faithful round-trip of hand-authored YAML (comments, ordering) is fragile, and it
conflicts head-on with i18n — native inline strings (`name: "…"`) vs Artisan
keys+`lang/`. The plugin would have to adopt Artisan's i18n resolution anyway, erasing
A's main advantage. Since the owner confirmed i18n matters and wants core-kind reuse,
**B** is the working direction.

## Consumers / validation

Boutique (validates master-detail UX + simple catalog; gains i18n `name`/`lore` once
migrated) and Quests (validates maps/unions/enums/deep nesting/core-kind reuse) are the
two forcing functions.

## Rough build sequence (indicative, pre-grill)

1. Type-system extensions: map, discriminated union, enum; fix model reuse.
2. Reuse of core kinds (Action DSL / conditions / field kit) inside schemas.
3. Form generator + UI-schema layer (layout, master-detail, per-variant forms).
4. Migrate boutique onto it (with i18n `name`/`lore`).
5. Onboard quests.

## Deferred / open (for the grill)

- Exact document model: one-file-per-instance vs Table-of-model; how the dev controls
  file granularity ("architecturer les yaml comme on veut" within B's conventions).
- UI-schema vocabulary: how much layout control; how master-detail is declared.
- How Add-on-declared schemas reach Artisan: SDK-shipped schema synced at hello (like
  `data_sources` presence, but richer) vs authored in the editor.
- Integrity of Add-on-owned fields: the **locked / required / default / min-max
  constraints** idea explored 2026-07-22 lands here (only needed if editing isn't
  purely bespoke — a bespoke form guarantees integrity by construction).
- Migration of existing Add-on formats (boutique `shop.yaml`; quests native `.yml`) —
  prod shops/quests are not resettable.
