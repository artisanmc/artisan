# Field-local translations — the Document carries its languages

**Status:** proposed (2026-09-30)

## Context

The current i18n model (ADR `files-first-source-of-truth` §4, amendments
2026-07-30 and 2026-08-03) stores translations **per project**, in
`lang/<lang>.yaml`, keyed by a **canonical address derived from position**
(`menus.shop.elements.buy.default.title`). Two modes coexist: `extract`
(`{i18n:key}` keys in the documents, all languages in `lang/`) and
`inline` (default-language literal in the document, other languages
in `lang/` at the site's address). The address is minted editor-side
(`domain/i18nSites.ts`, `lib/i18nKeys.ts`) and recomputed plugin-side
(`engine/I18nAddresses.kt`, `MenuTitleParser`, `DialogTextResolver`), both
implementations locked by `testdata/i18n-address-conformance.json`.

Two problems motivate this change:

- **Document portability.** Copying a menu from one server to another (FTP,
  export, sharing) loses its translations, buried in the project's `lang/`; since
  the keys are project-scoped and position-derived, they also have to be
  re-addressed in the target. Yet the Document is the unit we share.
- **Readability / hand editing.** A menu's content and its translations
  live in two files (even three forms) that an admin editing on disk
  has to reconcile mentally.

Deployment constraint: Artisan runs in prod on one server, **single-language,
in inline mode**. The switch must happen with no file migration and no breakage.

The ADR `files-first-source-of-truth` §4 had already **deferred** an inline
"`translations:` block per document" on the grounds that it required a fragile
positional key derivation. This ADR retains a **different form** — the
translation is carried **at the field** (at the Key site), with no address at
all — which eliminates precisely that fragility.

## Decision

1. **A text slot carries its languages on disk.** The shape of a text becomes
   `string | Record<LangCode, string>` (and for lists
   `string[] | Record<LangCode, string[]>`). A Document's languages live in the
   Document.

   ```yaml
   title: "Retour"                    # sugar for {<defaultLang>: "Retour"}
   title: { fr: "Retour", en: "Back" } # explicit map
   title: "{i18n:common.close}"        # escape hatch to the shared store
   ```

2. **A bare string is sugar for `{<defaultLang>: literal}`.** This is the
   semantics of the current inline mode: the literal is the default language's
   value, the other languages are missing and therefore **detected**
   (`isTranslationMissing`). *Rejected:* "a string = universal value for all
   languages" — same runtime rendering, but the translation gap would never
   surface.

3. **Per-field resolution:** requested language → `defaultLang` → literal. An
   `{i18n:key}` (string) is still resolved against the project's `lang/` and is
   the only escape hatch to a shared key. Three forms coexist per field —
   local literal, local map, global ref — **never** a field that is both string
   and map.

4. **Disambiguation by type, not by content.** Key sites form a closed set
   (single traversal `i18nSites.ts` / `I18nAddresses.kt`): the parser knows
   *a priori* which fields are texts. In a text slot, any map is a lang-map; its
   keys must be valid `LangCode`s, otherwise the value is invalid. No shape
   heuristic.

5. **The positional address subsystem is removed for documents.**
   Addresses only existed to attach non-default translations stored in `lang/` to
   anonymous inline-mode literals. Since structural fields now carry their
   languages, nothing needs to be addressed at runtime anymore.

6. **Action texts live in the DSL string, so they stay explicit refs.**
   `send_message`, `broadcast`, `show_title` and the `name`/`lore` of
   `give_item` are serialized inside the Action DSL (`ClickHandlerYaml.steps:
   String`), where a text argument is either a `"..."` literal or an
   `@key` ref (`actiondsl/Ast.kt`). A language map **cannot** be housed there.
   Decision (option A): the editor emits action texts as **explicit `@key`
   refs** (`{i18n:key}` after the DSL bridge), their values living in
   `lang/`. No more positional address, but action messages are **not**
   carried by copying a document — an accepted gap, to be reopened in a
   dedicated task (take action texts out of the DSL string).

   > **Reopened and resolved on 2026-09-30** by the `structured-action-wire` ADR: the
   > action wire becomes **structured (YAML keyed by name)**, so an action text is
   > an **inline `LocalizedText`** like structural texts, and the DSL goes back
   > to being a mere editing view. This decision 6 describes the intermediate
   > state (option A); the target is the structured wire. **Data source
   scope:** unchanged, they keep positional addressing (ADR
   `bare-data-files` ④), a lang-map in a table cell would fight the
   data model.

7. **Lazy migration, zero breakage.** Existing inline literals are
   read as `{defaultLang: literal}`; `extract` projects continue via
   `{i18n:key}`. No file to migrate, no re-addressing. Promotion
   string → map only happens when a second language is entered.
   Keys with no site (`artisan.duration.*`) stay in `lang/`.

*Rejected at the root:* a `translations:` block per document with addresses
inside — it would reintroduce address matching **in** the file **and**
a second store (the worst of both). The field-local form avoids it.

> **Clarified on 2026-10-24 (lore).** The list form of §1, `Record<LangCode, string[]>`, is
> the canonical form of a translated lore: one list per language, fallback per block. The
> implementation had first carried a map per line (`[{en, fr}, …]`), which forces the same
> number of lines on all languages and does a line-by-line fallback (mixed lore with no
> signal); the editor also lost these lines on import. That form is still read, no longer
> written. Translation keys (`{i18n:key}`) remain the escape hatch, not the default form.

## Consequences

- **Editor** — `LText { key }` (`domain/types.ts`) becomes
  `LocalizedText = string | Record<LangCode, string> | { i18n: I18nKey }`.
  `Project.i18nKeys` / `getText` / `setLText` only serve **referenced** (shared)
  keys; `i18nSites.ts` loses rekey/mint/release in favor of direct accesses;
  `transform.ts` (`textSerializer`, `serializeLang`) and
  `projectFromFiles.ts` (`readTranslations`) handle the union form.
- **Plugin** — the text fields of the YAML models (`AppearanceYaml.title/lore`,
  dialog labels, title layers' `LText`) become a value type carrying
  `string | map`; `resolveText`/`resolve` lose the `address` parameter;
  `I18nAddresses.kt` and `MenuTitleParser`'s stamping are removed for
  documents. **Tolerant** reading: the old addressed form stays readable during
  the switch.
- **Vectors / codecs** — `testdata/i18n-address-conformance.json` is removed
  for documents (kept for data sources if applicable); the `langTree` codec
  (`nestLangTree`/`LangFlattener`) remains necessary for refs and data
  sources.
- **Portability**: copying a Document carries its translations. Adding a
  language = a bulk pass over the documents ("scan for missing" tooling +
  import), no longer a file to create.
- **AI / translation**: a Document is self-sufficient (structure + texts + all
  languages); the global `lang/` remains a **derived aggregated view** for
  translation jobs, without being canonical.
- **Doc impact**: `docs/architecture/project-files.md` (`lang/` layout),
  `docs/architecture/editor-internals.md` (§ i18n `extract`/`inline`),
  `docs/decisions/files-first-source-of-truth.md` §4 (amendment),
  `CONTEXT.md` (LText, Key site), `docs/schema/menu/v1` + `dialog/v1`.
- **Amends** the `files-first-source-of-truth` ADR §4: the "deferred
  `translations:` block" is replaced by **field-level** translations, and inline
  becomes a lazily migrated starting point, not a mode maintained indefinitely.
