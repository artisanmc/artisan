import type { Command, Dialog, Document, Menu, Project, ProjectId } from "@/domain/types";
import { commandV1FromDomain } from "./commandV1FromDomain";
import { commandV1ToDomain } from "./commandV1ToDomain";
import { dialogV1FromDomain } from "./dialogV1FromDomain";
import { dialogV1ToDomain } from "./dialogV1ToDomain";
import { menuV1FromDomain } from "./menuV1FromDomain";
import { menuV1ToDomain } from "./menuV1ToDomain";

/**
 * The file codec of each document kind (ADR `extensible-document-kinds`,
 * decision 1): what `projectFromFiles` runs on `<dir>/<id>.yaml` and what
 * `projectToFiles` writes back. A kind in the registry without a codec cannot
 * be imported, so a module registers both together. Each core kind has its two
 * directions side by side in this folder: `<kind>V1ToDomain.ts` (read) and
 * `<kind>V1FromDomain.ts` (write).
 *
 * `projectToFiles.ts` reads this registry for its write loop while the core
 * codecs never import it back: no cycle.
 */
export interface DocumentParseOpts {
  projectId: ProjectId;
  lang: string;
  translations?: Record<string, Record<string, string>>;
}

export interface DocumentParseResult {
  doc: Document;
  i18nKeys: Record<string, Record<string, string>>;
  /** Constructs of the file without a domain equivalent, dropped on import. */
  unsupported: string[];
}

export interface DocumentCodec {
  kind: string;
  /** `src` carries the file's content plus `id` (the filename). */
  parse(src: Record<string, unknown>, opts: DocumentParseOpts): DocumentParseResult;
  /** The canonical file object, `id` included — `projectToFiles` strips it. */
  serialize(doc: Document, project: Project): Record<string, unknown>;
}

const codecs = new Map<string, DocumentCodec>();

export function registerDocumentCodec(codec: DocumentCodec): void {
  codecs.set(codec.kind, codec);
}

export function documentCodec(kind: string): DocumentCodec {
  const codec = codecs.get(kind);
  if (!codec) throw new Error(`document kind ${kind} has no codec`);
  return codec;
}

function registerCoreCodecs(): void {
  registerDocumentCodec({
    kind: "menu",
    parse: (src, opts) => {
      const r = menuV1ToDomain(src, opts);
      return { doc: r.menu, i18nKeys: r.i18nKeys, unsupported: r.unsupported };
    },
    serialize: (doc, project) => menuV1FromDomain(doc as Menu, project),
  });
  registerDocumentCodec({
    kind: "command",
    parse: (src, opts) => {
      const r = commandV1ToDomain(src, opts);
      return { doc: r.command, i18nKeys: r.i18nKeys, unsupported: r.unsupported };
    },
    serialize: (doc, project) => commandV1FromDomain(doc as Command, project),
  });
  registerDocumentCodec({
    kind: "dialog",
    parse: (src, opts) => {
      const r = dialogV1ToDomain(src, opts);
      return { doc: r.dialog, i18nKeys: r.i18nKeys, unsupported: r.unsupported };
    },
    serialize: (doc, project) => dialogV1FromDomain(doc as Dialog, project),
  });
}

/** Test-only: back to the core codecs. */
export function resetDocumentCodecs(): void {
  codecs.clear();
  registerCoreCodecs();
}

registerCoreCodecs();
