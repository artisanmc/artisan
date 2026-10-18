# Module templates: example content copied into any Project

**Status:** accepted (2026-10-18). Plugin side: API 2.6.0, protocol 1.3. Editor: `ModuleTemplatesDialog`
(catalog, per-file states, reset, read-only default version to copy from).

## Context

A module's kinds (quest groups, shop catalog, menus) work in **every** Project of the server: a
module is not tied to "its" Project. Yet a module wants to ship example content (a daily quests
group, its menus), which the owner must be able to delete, restore after a plugin update that
changed it, and compare to what is shipped, copying parts of it back. An Add-on-owned root
(ADR `addon-owned-project-roots`) answers none of that: the content is either the module's
(immutable, overwritten on update) or the owner's (no link to the original).

## Decision

1. **A template is plugin-owned, read-only content** declared by the module from `onEnable`
   (`api.getTemplates()`, `TemplateDeclaration`: an id, a version raised when the files change,
   project-relative files, an optional seed project). It never lives on disk as a Project: the
   jar holds it, Presence announces it without content (`installed_modules[].templates`, paths
   and SHA-256), the hub reads the files on demand (`template_fetch`).
2. **A copy is the owner's.** `template_copy` writes the files into a Project (all or some
   `paths`) and records each one's origin in `.artisan/origins.yaml` (module, template, version,
   hash as shipped), in one journaled commit, then reloads. A file holding other content is never
   overwritten unless `replace` is asked: the reply lists the conflicts and nothing is written.
3. **States come from the origins and the hashes**, computed by the editor: same hash as recorded
   → untouched copy; other content → modified; recorded but missing → removed; recorded version
   below the announced one → update available. An update is **never applied automatically**: the
   editor shows it and copies on a click.
4. **Seed once.** A template with a seed project is copied into a new Project of that name, in the
   core root, the first start that knows it; recorded in `<core projects root>/.artisan-seeds.yaml`
   and never repeated, even when the owner deletes that Project. A Project of that name already
   there is left alone.
5. **Keys stay unique on the server.** Content read from all Projects (quest groups) refuses a key
   defined twice, with a visible error, instead of silently picking one.

## Consequences

- The default version is always available, whatever the owner did to their copy.
- `.artisan/origins.yaml` is plugin-owned metadata: out of the hash, not in the database
  (`project_origins_fetch` needs the server online), invisible and read-only to the editor.
- A rename in the editor drops the link: the renamed file is the owner's, its origin entry reads
  as removed.
- An older leaf (protocol < 1.3) announces no templates; the three routes answer 501.
