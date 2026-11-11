# The editor as an assisted YAML editor — the schema is an option, not a toll

**Status:** accepted (2026-07-27) — **implemented (2026-07-28/29)**: visible hints
+ per-key comments (⑥⑨), Config typed by declared model, YAML tab on the config
screens **and** in the Data panel (⑦⑧), `@key` in data source actions (④, plugin +
editor contract locked by test). Not done: the YAML tab on canvas documents (⑧,
announced follow-up) and circles ②③ (third-party plugin files). Revises
`module-config-screens` §2, `bare-data-files` ⑦ and `action-dsl` (text of data source
actions); partially delivers the "code mode" deferred by `files-first-source-of-truth`.

## Context

The Config screens were built on the premise "a screen edits a Table/Config **with a
declared model**". In immediate use, two frictions:

- A settings file without a declared model gave an **empty form** — and worse, a save
  **emptied** it (the writer serializes against the model's field list; empty list ⇒
  `{}`). Real incident on 2026-07-27, `shop_settings.yaml` reduced to `{}`; same latent
  trap on a table whose declared model is not yet delivered by Presence (rows reduced
  to `[{}]`).
- The owner wants to be able to **comment their fields** and **switch between YAML and
  the form**, noting that "it is always more intuitive to go through config" — a config
  *shows* its explanations.

Hence the proposed shift of emphasis: what we edit are **YAML files**; the schema is
only a layer of assistance laid on top.

## Decisions

**① The schema is a progressive enhancement.** A developer's minimum work to make their
config editable is to **expose their file**; they can then declare a schema to gain
labels, descriptions and constraints. A file without a schema is editable, never a dead
end: its keys appear as **literal fields** typed from the stored values. *Revises
`module-config-screens` §2* ("a Table/Config with a declared model" is no longer a
prerequisite). *Rejected:* requiring a model — it is a toll that forbids precisely the
entry-level case aimed at.

**② Without a resolvable schema, values travel verbatim.** Field-driven serialization
only applies if fields exist. This is the fix of the incident above, raised to the rank
of a rule: *the values are the user's data, the schema is only a reading of them.*

**③ The file's location decides its guarantees.** No per-file setting: in a project
root ⇒ versioned, history, editable offline, divergence resolved; outside a project ⇒
live-only, no safety net. The developer chooses **where to put their file**, the
guarantees follow — and `addon-owned-project-roots` lets them place their project root
**at home** (`plugins/Boutique/editor/`), so without arbitrating between "my folder" and
"Artisan's folder". The asymmetry is **displayed** in the screen: it is a chosen
property, not an implementation detail.

**④ i18n follows the consumer, not the file.** Content consumed by Artisan's runtime
(menus, dialogs, bound sources) lives in a project root and is translated through its
`lang/<code>.yaml`, in the same place. A file consumed by its own plugin (its
`config.yml`) is literal text for us: its translation is its owner's business, and we
never write keys into someone else's folder. *Rejected:* a global language scope
`plugins/Artisan/lang/` for the content of others — translations and translated file
would end up in two different folders, incoherent and lock-in.
> Corollary that **revises `action-dsl`**: a data source action **may** carry `@key`
> (the mechanism already exists end to end — `DslText.Ref` → `{i18n:key}` →
> `ActionExecutor.resolveText`), *because* these sources are consumed by Artisan. The
> only thing missing is passing the project's `langMap` to `api.actions.execute`, which
> today builds an `ExecutionContext` without a language. The key stays **explicit**
> (never derived from a position in the chain — the fragility already refused by
> `files-first` ④).

**⑤ Two kinds of roots, like a ramp.** Simple root ("expose your yml, you have an
editor") → project root ("adopt the structure, you gain history and offline"). Circle ③
of `module-config-screens` (third-party plugin files) is open **only to consenting
modules** that declare their file; never on a non-consenting plugin without a declared
`reload_command`.

**⑥ We do not fight comments — we generate them.** User comments are **not** preserved;
the schema's `label`/`description` are projected as comments **above each key**
(application of `bare-data-files` ⑦ as written — the code grouped them in a header
block) and regenerated at each write. The generated header **says frankly** that
hand-written comments are overwritten. *Rejected after examination:* preserving writing
by surgical patch (CST) — the domain does not retain the written form (`positionsSpec`
reduces `[1,2,3]` and `"1-3"` to the same string, a string `title:` becomes layers,
templates are resolved at import), so preserving it would require either the provenance
of each sugar in the domain (the double representation demolished by `files-first`), or
an identity matching per document type. Ruled out for a debatable benefit: who comments
a menu by hand?

**⑦ Two modes, a single truth per file.**
- Our files: form **and** YAML tab, both writing **canonical** (immediate
  canonicalization, including from the YAML tab).
- Foreign file: **only** the YAML tab, **verbatim** writing (the text seen is the text
  sent); the form, if it exists thanks to a declared schema, is **read-only** and cannot
  save — otherwise canonicalization would destroy its owner's config.
- **Invalid YAML** ⇒ the Form tab becomes unavailable (error + line), the Code tab stays
  editable, and **saving remains possible**: it is your file. Transposition of the
  pattern already validated in `ActionFieldEditor` (Visual/Code on the same chain,
  fallback to text if the parse fails). *Rejected:* blocking the save (the editor would
  make itself the guardian of what does not belong to it) and freezing the form on the
  last valid version (displaying stale data next to the real text — the duality that
  produced the incident of the day).

  > **Revised 2026-08-14 — the YAML tab of an Artisan document also writes
  > verbatim** (ADR `server-disk-only-storage` ④). Immediate canonicalization from
  > this tab was decided when the web editor was the main surface and the file a
  > projection: erasing comments and formatting cost little. Since then, the disk is
  > the **only** store and hand editing a full-fledged path — an admin lost their
  > porting comments on their own menus by saving from the editor (2026-08-13).
  >
  > What you type in the YAML tab is what lands. Canonicalization only triggers if
  > the **visual** editor touches the document, which regenerates it. Accepted
  > trade-off: the two modes no longer produce the same bytes for the same content —
  > but the text is before your eyes, so the reformatting becomes visible instead of
  > being a surprise afterwards.
  >
  > Verbatim writing is **not** a privileged write: it goes through the same per-file
  > compare-and-swap as the rest.

**⑧ Scope of the YAML tab**: module config screens **and** the canvas Data panel — the
same file edited by two surfaces cannot have two behaviors. Canvas documents (menus,
dialogs, commands) are the natural follow-up, opened on usage demand.

**⑨ The label does not erase the key.** In the form, the description becomes **visible
under the field** (no more tooltip), and the **technical name stays displayed** next to
the label: it is the file's real key, the one you look for over SSH. A single vocabulary
between the screen and the disk.

## Consequences

- The "file emptied to `{}`" incident becomes structurally impossible: without a schema,
  nothing is filtered.
- Circle ② (read-only form on third-party config) and a useful form of circle ③ (verbatim
  editing through the YAML tab) become reachable **without** preserving writing — this was
  the prerequisite announced by `module-config-screens` ④, bypassed here rather than paid.
- A hand-written menu loses its comments at the first save from the canvas. This was
  already true; it becomes an explicit rule.
- Open question unchanged: "live-only generalized to the canvas" (the server as the only
  store) remains to be grilled separately.

## Alternatives rejected at the root

- **The file's text as a permanent working copy** (surgical patch everywhere):
  considered and retained at the start of the session, then abandoned with the
  abandonment of user comments — the cost no longer had a counterpart.
- **Forbidding editing outside a project**: coherent but closes the "plug Artisan onto
  what exists" trajectory, which is the reason the mechanism exists.
