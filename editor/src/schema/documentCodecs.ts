import type { Command, Dialog, Document, Menu, Project, ProjectId } from "@/domain/types";
import { serializeCommand, serializeDialog, serializeMenuToV1 } from "@/features/export/transform";
import { commandV1ToDomain } from "./commandV1ToDomain";
import { dialogV1ToDomain } from "./dialogV1ToDomain";
import { menuV1ToDomain } from "./menuV1ToDomain";

/**
 * The file codec of each document kind (ADR `extensible-document-kinds`,
 * decision 1): what `projectFromFiles` runs on `<dir>/<id>.yaml` and what
 * `transform` writes back. A kind in the registry without a codec cannot be
 * imported, so a module registers both together.
 *
 * The core codecs close over `transform.ts`, which in turn reads this registry
 * for the export loop. The cycle is harmless: both sides only touch the other
 * from inside functions, never at module load.
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
  /** The canonical file object, `id` included — `transform` strips it. */
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
    serialize: (doc, project) => serializeMenuToV1(doc as Menu, project),
  });
  registerDocumentCodec({
    kind: "command",
    parse: (src, opts) => {
      const r = commandV1ToDomain(src, opts);
      return { doc: r.command, i18nKeys: r.i18nKeys, unsupported: r.unsupported };
    },
    serialize: (doc, project) => serializeCommand(doc as Command, project),
  });
  registerDocumentCodec({
    kind: "dialog",
    parse: (src, opts) => {
      const r = dialogV1ToDomain(src, opts);
      return { doc: r.dialog, i18nKeys: r.i18nKeys, unsupported: r.unsupported };
    },
    serialize: (doc, project) => serializeDialog(doc as Dialog, project),
  });
}

/** Test-only: back to the core codecs. */
export function resetDocumentCodecs(): void {
  codecs.clear();
  registerCoreCodecs();
}

registerCoreCodecs();
