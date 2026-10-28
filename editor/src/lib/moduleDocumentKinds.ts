import { projectNamespace } from "@/domain/docRef";
import { type ChainSlot, registerDocumentKindVisitors } from "@/domain/documentKindVisitors";
import {
  documentKindDef,
  isDocumentKind,
  listDocumentKinds,
  registerDocumentKind,
} from "@/domain/documentKinds";
import type { LTextSite } from "@/domain/i18nSites";
import type { Document, Project, ProjectId } from "@/domain/types";
import { type DocumentParseResult, registerDocumentCodec } from "@/schema/documentCodecs";
import {
  type DocumentKindContribution,
  type FrontendModule,
  getModule,
  registerModule,
} from "@artisan/editor-sdk";

/**
 * The host side of `FrontendModule.documents` (ADR `extensible-document-kinds`, lot 5):
 * a module's Document kinds enter the registries the host already reads — the kind
 * table (`domain/documentKinds.ts`), the file codecs (`schema/documentCodecs.ts`) and
 * the text/chain visitors (`domain/documentKindVisitors.ts`). The edit view, the label
 * and the board overrides stay on the contribution, read from the SDK registry by the
 * surfaces that render them. The core modules go through the same door.
 */
export function installDocumentKind(c: DocumentKindContribution): void {
  if (isDocumentKind(c.kind)) {
    const def = documentKindDef(c.kind);
    if (def.dir !== c.dir || def.schemaVersion !== c.schemaVersion) {
      throw new Error(
        `document kind ${c.kind} is already registered as ${def.dir}/ (${def.schemaVersion}); the module declares ${c.dir}/ (${c.schemaVersion})`,
      );
    }
  } else {
    registerDocumentKind({
      kind: c.kind,
      dir: c.dir,
      schemaVersion: c.schemaVersion,
      ...(c.idPrefix ? { idPrefix: c.idPrefix } : {}),
      // After the core kinds, in contribution order.
      rank: c.rank ?? listDocumentKinds().length,
    });
  }
  registerDocumentCodec({
    kind: c.kind,
    parse: (src, opts) => c.parse(src, opts) as DocumentParseResult,
    serialize: (doc, project) => c.serialize(doc, project),
  });
  registerDocumentKindVisitors(c.kind, {
    ...(c.ltextSites
      ? { ltextSites: (doc: Document) => c.ltextSites!(doc) as Iterable<LTextSite> }
      : {}),
    ...(c.chainSlots
      ? { chainSlots: (doc: Document) => c.chainSlots!(doc) as Iterable<ChainSlot> }
      : {}),
  });
}

export function installModuleDocumentKinds(mod: FrontendModule): void {
  for (const c of mod.documents ?? []) installDocumentKind(c);
}

/**
 * Registers a module in the SDK registry and installs its Document kinds in the host.
 * The one way a module enters the editor (`main.tsx` for the core, `modulesStore` for
 * the presence-gated ones); a module already registered is left as is.
 */
export function registerEditorModule(mod: FrontendModule): void {
  if (getModule(mod.id)) return;
  registerModule(mod);
  installModuleDocumentKinds(mod);
}

/**
 * Whether a Document of this kind may be created in `project` (SDK 1.8): a kind listing
 * `projects` is offered only in those folders, matched on the disk id (`projectNamespace`).
 */
export function kindCreatableIn(
  c: DocumentKindContribution,
  project: { id: string; diskId?: string } | undefined,
): boolean {
  if (!c.projects) return true;
  if (!project) return false;
  return c.projects.includes(projectNamespace(project));
}

/** A fresh Document of a kind, through its contribution's seed. */
export function createDocumentOfKind(
  c: DocumentKindContribution,
  id: string,
  projectId: ProjectId,
): Document {
  return c.create({ id, projectId }) as Document;
}

/**
 * A module kind's plural name in the interface language: its own `labels`, else its
 * `label` read as a host i18n key or a literal, else the kind id.
 */
export function contributionLabel(
  c: DocumentKindContribution | undefined,
  kind: string,
  t: (key: string, opts: { defaultValue: string }) => string,
  uiLang: string,
): string {
  const own = c?.labels?.[uiLang] ?? c?.labels?.en;
  if (own) return own;
  const label = c?.label ?? kind;
  return t(label, { defaultValue: label });
}

/** The human label of a Document: the kind's `title`, else its id. */
export function documentTitle(
  c: DocumentKindContribution | undefined,
  doc: Document,
  project: Project,
  lang: string,
): string {
  return (c?.title ? c.title(doc, { project, lang }) : "") || doc.id;
}
