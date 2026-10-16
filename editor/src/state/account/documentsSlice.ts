import { walkDocumentRefs } from "@/domain/actionArgs";
import { documentChainSlots, documentLTextSites } from "@/domain/documentKindVisitors";
import { documentKindDef } from "@/domain/documentKinds";
import { allDocuments, documentsOf, hasDocument, mutableDocuments } from "@/domain/documents";
import { mintLTexts, rekeyDocument } from "@/domain/i18nSites";
import type { ProjectId } from "@/domain/types";
import { createDocumentOfKind } from "@/lib/moduleDocumentKinds";
import { useProjectDraftStore } from "@/state/projectDraftStore";
import { documentKindContribution } from "@artisan/editor-sdk";
import { rewriteCanvasEdgeIds, rewriteCanvasGroupMembers } from "./helpers";
import type { AccountSliceContext } from "./types";

/**
 * Documents of any kind, through the kind registry (ADR `extensible-document-kinds`,
 * lot 5): creation from the contribution's seed and renaming. The core kinds keep their
 * dedicated reducers (`createMenu`, `setDialogId`, …); a module's kind has only these
 * two, plus whatever its own view does through `updateDocument`.
 */
export interface DocumentsSlice {
  /** A new Document of a registered kind; its texts are minted at their canonical keys. */
  createDocument: (input: {
    projectId: ProjectId;
    kind: string;
    id: string;
    position?: { x: number; y: number };
  }) => string;
  /** Replaces a Document of a kind wholesale (a module's view edits a copy, then commits it). */
  updateDocument: (input: { projectId: ProjectId; kind: string; id: string; doc: unknown }) => void;
  /** Renames a Document: its texts, its board position, its edges, its groups and every reference to it follow. */
  setDocumentId: (input: {
    projectId: ProjectId;
    kind: string;
    oldId: string;
    newId: string;
  }) => void;
}

export const createDocumentsSlice = ({
  get,
  mutateProject,
}: AccountSliceContext): DocumentsSlice => ({
  createDocument: ({ projectId: pId, kind, id, position }) => {
    const contribution = documentKindContribution(kind);
    if (!contribution) throw new Error(`no module contributes the document kind "${kind}"`);
    const project = get().account.projects.find((p) => p.id === pId);
    if (!project) throw new Error("project not found");
    if (hasDocument(project, id)) throw new Error(`document id "${id}" already exists`);
    mutateProject(pId, (p) => {
      const doc = createDocumentOfKind(contribution, id, pId);
      mutableDocuments(p, kind).push(doc);
      mintLTexts(p, documentLTextSites(kind, doc), p.defaultLang);
      if (position) {
        (p.canvasLayout as Record<string, { x: number; y: number }>)[id] = position;
      }
    });
    return id;
  },
  updateDocument: ({ projectId: pId, kind, id, doc }) =>
    mutateProject(pId, (p) => {
      const docs = mutableDocuments(p, kind);
      const index = docs.findIndex((d) => d.id === id);
      if (index < 0) return false;
      docs[index] = doc as (typeof docs)[number];
    }),
  setDocumentId: ({ projectId: pId, kind, oldId, newId }) => {
    if (oldId === newId) return;
    if (!newId) throw new Error("document id cannot be empty");
    const project = get().account.projects.find((p) => p.id === pId);
    if (!project) throw new Error("project not found");
    if (!documentsOf(project, kind).some((d) => d.id === oldId)) {
      throw new Error(`no ${kind} document "${oldId}"`);
    }
    if (hasDocument(project, newId)) throw new Error(`document id "${newId}" already exists`);
    mutateProject(pId, (p) => {
      const doc = documentsOf(p, kind).find((d) => d.id === oldId)!;
      doc.id = newId as typeof doc.id;
      // Texts are addressed by the id: the visitor moves each one to its new home.
      rekeyDocument(p, kind, doc);
      const layout = p.canvasLayout as Record<string, { x: number; y: number }>;
      if (layout[oldId]) {
        layout[newId] = layout[oldId]!;
        delete layout[oldId];
      }
      rewriteCanvasEdgeIds(p, oldId, newId);
      rewriteCanvasGroupMembers(p, oldId, newId);
      // Every `document_ref` of that kind pointing at the old id follows (R3).
      for (const other of allDocuments(p)) {
        for (const slot of documentChainSlots(other.kind, other.doc)) {
          for (const ref of walkDocumentRefs(slot.steps)) {
            if (ref.document === kind && ref.id === oldId) ref.set(newId);
          }
        }
      }
    });
    // A rename is a move on disk; see `setDialogId` for why it is recorded after the apply.
    const dir = documentKindDef(kind).dir;
    useProjectDraftStore
      .getState()
      .recordRename(pId, `${dir}/${oldId}.yaml`, `${dir}/${newId}.yaml`);
  },
});
