import { documentLTextSites } from "@/domain/documentKindVisitors";
import type { Document, I18nKey, Project, ProjectId, ProjectOriginals } from "@/domain/types";
import { fetchTemplateFiles } from "@/lib/api/templates";
import { newI18nKey } from "@/lib/i18n";
import { MODULE_FILE } from "@/lib/yamlFiles";
import { projectFromFiles } from "@/schema/projectFromFiles";
import { stringify } from "yaml";

/**
 * The shipped version of each Document of a folder that holds its module's whole tree (ADR
 * `editable-module-tree`): read from the module's templates named in `artisan-shipped.yml`,
 * on demand (the server, or the hub's cache with the server off), never stored on disk. They
 * fill `Project.originals.documents` for the comparison, the way back and the required files.
 */

/** The (module, template) pairs the index names, each once. */
export function shippedTemplates(project: Project): { module: string; template: string }[] {
  const index = project.originals?.inTree ? project.originals.index : undefined;
  const seen = new Map<string, { module: string; template: string }>();
  for (const e of Object.values(index ?? {}))
    seen.set(`${e.module}\u0000${e.template}`, { module: e.module, template: e.template });
  return [...seen.values()];
}

export interface ShippedTwins {
  documents: ProjectOriginals["documents"];
  show?: ProjectOriginals["show"];
  /** The texts the shipped Documents name and the Project lacks. */
  i18nKeys: Project["i18nKeys"];
}

/** The Documents of [templates]' files as shipped, read like the Project's (its languages). */
export function shippedTwinsOf(
  project: Project,
  templates: Record<string, string>[],
): ShippedTwins {
  const documents: ProjectOriginals["documents"] = {};
  const i18nKeys: Project["i18nKeys"] = {};
  let show: ProjectOriginals["show"];
  const langs = [
    ...new Set([project.defaultLang, ...Object.values(project.i18nKeys).flatMap(Object.keys)]),
  ];
  const manifest = stringify({
    schema: "module/v1",
    default_lang: project.defaultLang,
    languages: langs,
    files: { menus: [], commands: [] },
  });
  templates.forEach((files, i) => {
    const id = `__shipped__${project.id}_${i}` as ProjectId;
    const base = `plugins/Artisan/projects/${id}`;
    const map: Record<string, string> = { [`${base}/${MODULE_FILE}`]: manifest };
    for (const [path, content] of Object.entries(files)) map[`${base}/${path}`] = content;
    const shipped = projectFromFiles(id, map, { name: id });
    const put = (variant: string, kind: string, docs: Document[]) => {
      if (docs.length === 0) return;
      for (const doc of docs) ownTexts(kind, doc, shipped.i18nKeys, i18nKeys);
      const ofVariant = documents[variant] ?? {};
      documents[variant] = ofVariant;
      const known = new Set((ofVariant[kind] ?? []).map((d) => d.id));
      ofVariant[kind] = [...(ofVariant[kind] ?? []), ...docs.filter((d) => !known.has(d.id))];
    };
    for (const [kind, docs] of Object.entries(shipped.documents)) put("", kind, docs as Document[]);
    for (const [variant, byKind] of Object.entries(shipped.variants?.documents ?? {}))
      for (const [kind, docs] of Object.entries(byKind)) put(variant, kind, docs);
    if (!show && shipped.variants) show = shipped.variants.show;
  });
  return { documents, ...(show ? { show } : {}), i18nKeys };
}

/**
 * The texts of a shipped [doc] under keys of their own, values from [from] into [into]: read
 * apart from the Project, its canonical keys (`menus.<id>.…`) and minted ones would be the
 * owner's. A key named by the file (`{i18n:…}`) stays the module's message.
 */
function ownTexts(
  kind: string,
  doc: Document,
  from: Project["i18nKeys"],
  into: Project["i18nKeys"],
): void {
  for (const site of documentLTextSites(kind, doc)) {
    const key = site.lText.key;
    if (key !== site.key && !key.startsWith("lt_")) continue;
    const fresh = newI18nKey();
    into[fresh] = { ...(from[key] ?? {}) };
    site.lText.key = fresh;
  }
}

/** [twins] become the Project's shipped Documents (an immer draft in the store). */
export function adoptShippedTwins(project: Project, twins: ShippedTwins): boolean {
  const o = project.originals;
  if (!o?.inTree) return false;
  o.documents = twins.documents;
  if (twins.show) o.show = twins.show;
  for (const [key, value] of Object.entries(twins.i18nKeys))
    if (!(key in project.i18nKeys)) project.i18nKeys[key as I18nKey] = value;
  return true;
}

/** The templates' files, from the Project's server; null when one could not be read. */
export async function fetchShippedTwins(project: Project): Promise<ShippedTwins | null> {
  const serverId = project.serverKeyId;
  const templates = shippedTemplates(project);
  if (!serverId || templates.length === 0) return null;
  const read = await Promise.all(
    templates.map((t) => fetchTemplateFiles(serverId, t.module, t.template)),
  );
  const files = read.flatMap((r) => (r.ok ? [r.files] : []));
  if (files.length === 0) return null;
  return shippedTwinsOf(project, files);
}
