// What the module ships (design `originaux-modules`): `originals/`, written by the server,
// read into `Project.originals`. A Document of the Project equal to its shipped twin is the
// original (nothing written for it); one that differs is the owner's version; one without a
// twin was added by the owner. Pure functions on a Project (an immer draft in the store).
import { documentCodec } from "@/schema/documentCodecs";
import { listDocumentKinds } from "./documentKinds";
import { documentPath, sameFile } from "./documentLayout";
import { gcDocumentLTexts } from "./i18nSites";
import type { Document, Project } from "./types";
import { copyDocument, versionOf } from "./variants";

export type OriginStatus = "original" | "modified" | "added";

/** The shipped twin of (kind, id) in [variant] (`""`: the module's own). */
export function shippedTwin(
  project: Project,
  kind: string,
  id: string,
  variant = "",
): Document | undefined {
  return project.originals?.documents[variant]?.[kind]?.find((d) => d.id === id);
}

/** Where the Document shown for (kind, id) belongs: the viewed variant's version, or the module's. */
function variantOf(project: Project, kind: string, id: string): string {
  return versionOf(project, kind, id) ?? "";
}

const serialized = new WeakMap<object, WeakMap<object, string>>();

/** [doc] as its file holds it, keyed by its texts' current values. */
function fileOf(project: Project, kind: string, doc: Document): string {
  let byDoc = serialized.get(project.i18nKeys);
  if (!byDoc) {
    byDoc = new WeakMap();
    serialized.set(project.i18nKeys, byDoc);
  }
  let out = byDoc.get(doc);
  if (out === undefined) {
    const { folder: _folder, ...body } = documentCodec(kind).serialize(doc, project) as Record<
      string,
      unknown
    >;
    out = stable(body);
    byDoc.set(doc, out);
  }
  return out;
}

function stable(v: unknown): string {
  return JSON.stringify(v, (_k, value) =>
    value && typeof value === "object" && !Array.isArray(value)
      ? Object.fromEntries(
          Object.keys(value)
            .sort()
            .map((k) => [k, value[k]]),
        )
      : value,
  );
}

/** Whether [doc] says what its shipped [twin] says. */
export function sameAsShipped(
  project: Project,
  kind: string,
  doc: Document,
  twin: Document,
): boolean {
  return fileOf(project, kind, doc) === fileOf(project, kind, twin);
}

/** Where the Document shown for (kind, id) comes from; undefined when the module ships nothing. */
export function originStatus(project: Project, kind: string, id: string): OriginStatus | undefined {
  if (!project.originals) return undefined;
  const doc = project.documents[kind]?.find((d) => d.id === id);
  if (!doc) return undefined;
  const twin = shippedTwin(project, kind, id, variantOf(project, kind, id));
  if (!twin) return "added";
  return sameAsShipped(project, kind, doc, twin) ? "original" : "modified";
}

/** The shipped twin of the Document shown for (kind, id), when it has one. */
export function shownTwin(project: Project, kind: string, id: string): Document | undefined {
  return shippedTwin(project, kind, id, variantOf(project, kind, id));
}

/** The Document shown for (kind, id) becomes its shipped twin again. False without a twin. */
export function revertToOriginal(project: Project, kind: string, id: string): boolean {
  const twin = shownTwin(project, kind, id);
  const list = project.documents[kind];
  const at = list?.findIndex((d) => d.id === id) ?? -1;
  if (!twin || !list || at < 0) return false;
  gcDocumentLTexts(project, kind, list[at]!);
  list[at] = copyDocument(project, kind, twin);
  return true;
}

/** Path of a shipped Document relative to `originals/`, as the module file's exclusions name it. */
export function shippedPath(kind: string, doc: Document, variant = ""): string {
  const dir = listDocumentKinds().find((d) => d.kind === kind)?.dir ?? kind;
  const rel = documentPath(dir, doc.id, doc.folder);
  return variant ? `variants/${variant}/${rel}` : rel;
}

/** Whether the module's code needs (kind, id): it cannot be deleted. */
export function isRequired(project: Project, kind: string, id: string): boolean {
  const twin = shippedTwin(project, kind, id);
  if (!twin || !project.originals) return false;
  const required = new Set(project.originals.required.map(sameFile));
  return required.has(sameFile(shippedPath(kind, twin)));
}
