// Project → files writer: the exact inverse of `projectFromFiles.ts` (ADR
// files-first-source-of-truth: the file tree is the canonical, lossless Project
// representation; the editor parses it on open and serializes it back on every
// save). Each Document kind is written by its codec (`documentCodecs.ts`), data
// sources by `dataV1FromDomain.ts`, translations by `langV1FromDomain.ts`.
import { normalizeCanvasGroups } from "@/domain/canvasGroups";
import { listDocumentKinds } from "@/domain/documentKinds";
import { documentIds, documentsOf } from "@/domain/documents";
import type { Project } from "@/domain/types";
import { listLanguages } from "@/lib/i18nUsages";
import { nestLangTree } from "@/lib/langTree";
import { collectModuleExportFiles, getModule } from "@artisan/editor-sdk";
import { stringify } from "yaml";
import { dataSourceI18n, emitDataSources, modelV1FromDomain } from "./dataV1FromDomain";
import { documentCodec } from "./documentCodecs";
import { collectReferencedKeys, serializeLang } from "./langV1FromDomain";

/**
 * Removes the `id` field before writing a Document to disk: the file already
 * carries its identity in its name (mirror of the plugin's `withFileId`). The
 * serializers keep it because the AI assistant needs it on the wire, where
 * there is no file name to carry it.
 */
function withoutId(doc: Record<string, unknown>): Record<string, unknown> {
  const { id: _id, ...rest } = doc;
  return rest;
}

/** The raw files a project keeps for a module namespace no module has claimed. */
function rawModuleFiles(data: unknown): Record<string, string> | null {
  if (typeof data !== "object" || data === null || !("__files" in data)) return null;
  const files = data.__files;
  if (typeof files !== "object" || files === null) return null;
  return files as Record<string, string>;
}

/**
 * Transform a Project into a flat map of filename → YAML string.
 * Keys use the server-side path (e.g. "plugins/Artisan/projects/<id>/menus/shop_main.yaml").
 */
export function projectToFiles(project: Project): Record<string, string> {
  const files: Record<string, string> = {};

  const yamlOpts = { lineWidth: 0 };

  // DISK id: these paths are written as-is on the server, which stores the
  // project under its own folder name (cf. `Project.diskId`).
  const base = `plugins/Artisan/projects/${project.diskId ?? project.id}`;

  // One file per document, in its kind's folder, through its kind's codec
  // (ADR `extensible-document-kinds`): the writer knows no kind by name.
  for (const def of listDocumentKinds()) {
    const codec = documentCodec(def.kind);
    for (const doc of documentsOf(project, def.kind)) {
      files[`${base}/${def.dir}/${doc.id}.yaml`] = stringify(
        withoutId(codec.serialize(doc, project)),
        yamlOpts,
      );
    }
  }

  // Captured items: the opaque serialized stack is the runtime truth — emit it
  // VERBATIM (never parse/re-stringify), one file per item. The plugin
  // deserializes these to resolve `item:<id>` material refs with exact NBT.
  for (const item of project.capturedItems ?? []) {
    files[`${base}/items/${item.id}.yml`] = item.stackYaml;
  }

  const claimedModelIds = emitDataSources(project, base, files, yamlOpts);

  const langs = listLanguages(project);
  const referencedKeys = collectReferencedKeys(project);
  const dsI18n = dataSourceI18n(project);
  for (const lang of langs) {
    // `lang/` now only holds siteless presentation keys and data-source
    // addresses — document text is field-local in the documents.
    // Written as a YAML tree (`nestLangTree` sorts every level byte-order).
    const tree = nestLangTree(
      serializeLang(
        project,
        lang,
        referencedKeys,
        lang === project.defaultLang ? {} : (dsI18n.byLang[lang] ?? {}),
      ),
    );
    // Nothing to say for this language → no file (a pure mono-language,
    // structural-only project ships zero `lang/` files).
    if (Object.keys(tree).length === 0) continue;
    files[`${base}/lang/${lang}.yaml`] = stringify(tree, yamlOpts);
  }

  const liveIds = new Set<string>(documentIds(project));
  const editorLayout = Object.fromEntries(
    Object.entries(project.canvasLayout).filter(([id]) => liveIds.has(id)),
  );

  const manifest: Record<string, unknown> = {
    schema: "manifest/v1",
    // Round-trip the Add-on owner id (ADR addon-owned-project-roots) so it survives
    // an editor save — `ownerModule` is re-derived from it on load.
    ...(project.ownerModule ? { module: project.ownerModule } : {}),
    default_lang: project.defaultLang,
    languages: langs,
    ...(project.loreMaxWidth ? { lore_max_width: project.loreMaxWidth } : {}),
    ...(project.escapeGoesBack ? { escape_goes_back: true } : {}),
    // No `files:` block: it duplicated the content of menus/, commands/ and
    // dialogs/ without adding load order or exclusions — a hand-maintained index
    // whose only possible effect was to drift out of sync. Documents are
    // discovered by scanning, on both sides.
  };
  // Data models: models/<id>.yaml (model/v1), fields VERBATIM (cross-model refs
  // preserved) — the lossless editor store. data/<id>.yaml stays denormalized
  // and self-contained for the runtime (the plugin reads models/ only to type
  // a bare source beside its data).
  // Module-DECLARED models are NOT project content — their truth is the
  // declaration (Presence), never a project file (ADR composable-data-models §4).
  for (const m of project.dataModels ?? []) {
    if (m.provenance === "module") continue;
    // Owned by a source (doc emitted at models/<sourceId>.yaml, or an untyped
    // synthesized model with nothing to say) — ADR bare-data-files ⑤.
    if (claimedModelIds.has(String(m.id))) continue;
    files[`${base}/models/${m.id}.yaml`] = stringify(modelV1FromDomain(m), yamlOpts);
  }
  // Editor presentation state (board layout/edges) lives in the hash-excluded
  // `.artisan/editor.yaml` — NOT in the manifest — so cosmetic board moves no
  // longer change the project hash and redeploy the server (ADR
  // files-first-source-of-truth #3).
  const editorEdges = Object.fromEntries(
    Object.entries(project.canvasEdges ?? {}).filter(([edgeId, v]) => {
      const [src = "", tgt = ""] = edgeId.split("->");
      return liveIds.has(src) && liveIds.has(tgt) && (v.from || v.to);
    }),
  );
  const editorState: Record<string, unknown> = { schema: "editor-state/v1" };
  const groups = normalizeCanvasGroups(project.canvasGroups, liveIds);
  if (groups.length) editorState.groups = groups;
  // The i18n mode is a presentation choice about the file shape, not project
  // content — it rides in the hash-excluded editor state so flipping it back
  // and forth doesn't churn the project hash on its own. Only written when it
  // departs from the default, so `extract` projects keep a clean tree.
  if (project.i18nMode === "inline") editorState.i18n_mode = "inline";
  if (Object.keys(editorLayout).length > 0) editorState.layout = editorLayout;
  if (Object.keys(editorEdges).length > 0) editorState.edges = editorEdges;
  // Captured item label + display descriptor: editor-only metadata, persisted
  // here and hash-excluded. The descriptor IS derivable from the stack now
  // (projectFromFiles falls back to parseCapturedStack), but it is still
  // written: it records what the capture panel showed, including a material
  // enriched by the plugin's custom-item reverse lookup. The user-given `name`
  // has no equivalent in the stack at all.
  if ((project.capturedItems ?? []).length > 0) {
    editorState.items = Object.fromEntries(
      (project.capturedItems ?? []).map((ci) => [ci.id, { name: ci.name, display: ci.display }]),
    );
  }
  if (Object.keys(editorState).length > 1) {
    files[`${base}/.artisan/editor.yaml`] = stringify(editorState, yamlOpts);
  }
  for (const [rel, content] of Object.entries(collectModuleExportFiles(project))) {
    files[`${base}/${rel}`] = content;
  }

  // Defensive: moduleData namespaces no registered module claims (e.g. user-auth
  // mode where module registration never ran) must not be silently dropped from
  // the deploy. Re-emit their raw `__files` verbatim. Namespaces already
  // normalized by a module (no `__files`) have nothing faithful to emit —
  // documented limitation. Registered modules keep authority via exportFiles.
  for (const [ns, data] of Object.entries(project.moduleData ?? {})) {
    if (getModule(ns)) continue;
    const rawFiles = rawModuleFiles(data);
    if (!rawFiles) continue;
    for (const [rel, content] of Object.entries(rawFiles)) {
      files[`${base}/${ns}/${rel}`] = content;
    }
  }

  files[`${base}/manifest.yaml`] = stringify(manifest, yamlOpts);

  // No meta.yaml: nothing consumed it, and its `exported_at` timestamp made
  // every export a different byte tree. projectToFiles() is a pure function of
  // the Project.
  return files;
}
