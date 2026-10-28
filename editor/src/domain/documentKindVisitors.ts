import type { LTextSite } from "./i18nSites";
import type { Document, Step } from "./types";

/**
 * What the host must be able to walk in a Document of any kind (ADR
 * `extensible-document-kinds`, lot 5): its text sites, so the Translations panel,
 * the deploy-time rekey and the garbage collection see them, and its action chains,
 * so the board derives edges from their `document_ref` arguments and the chains'
 * texts get an address. The core kinds register theirs from `i18nSites.ts`; a module's
 * arrive through its `FrontendModule.documents` contribution
 * (`lib/moduleDocumentKinds.ts`).
 */
export interface ChainSlot {
  /** The slot's name in the Document ("left", "invoke", a button id). */
  name: string;
  steps: Step[];
  /** The i18n address prefix of the chain's texts. */
  prefix: string;
  /** What an edge shows for this trigger; `name` when absent. */
  label?: string;
}

export interface DocumentKindVisitors {
  ltextSites?: (doc: Document) => Iterable<LTextSite>;
  chainSlots?: (doc: Document) => Iterable<ChainSlot>;
}

const visitors = new Map<string, DocumentKindVisitors>();

/** Registers (or replaces) the visitors of a kind. */
export function registerDocumentKindVisitors(kind: string, v: DocumentKindVisitors): void {
  visitors.set(kind, v);
}

/** The text sites of one Document, none when its kind declares no visitor. */
export function* documentLTextSites(kind: string, doc: Document): Generator<LTextSite> {
  const v = visitors.get(kind)?.ltextSites;
  if (v) yield* v(doc);
}

/** The action chains of one Document, none when its kind declares no visitor. */
export function* documentChainSlots(kind: string, doc: Document): Generator<ChainSlot> {
  const v = visitors.get(kind)?.chainSlots;
  if (v) yield* v(doc);
}
