import { walkDocumentRefs } from "@/domain/actionArgs";
import { documentChainSlots, documentLTextSites } from "@/domain/documentKindVisitors";
import {
  allDocuments,
  docKey,
  documentsOf,
  hasDocument,
  mutableDocuments,
  renamedDocumentFiles,
} from "@/domain/documents";
import { mintLTexts, rekeyDocument } from "@/domain/i18nSites";
import type { I18nKey, Project, ProjectId, Step } from "@/domain/types";
import { setLText } from "@/lib/i18n";
import { createDocumentOfKind } from "@/lib/moduleDocumentKinds";
import { adoptLateDocuments } from "@/schema/projectFromFiles";
import { useProjectDraftStore } from "@/state/projectDraftStore";
import { documentKindContribution } from "@artisan/editor-sdk";
import { allocStepLTexts, gcStepLTexts, renameBoardKey } from "./helpers";
import type { ProjectsSliceContext } from "./types";

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
  /**
   * Replaces a Document of a kind wholesale (a module's view edits a copy, then commits
   * it), with the texts the edit sets: one step for undo.
   */
  updateDocument: (input: {
    projectId: ProjectId;
    kind: string;
    id: string;
    doc: unknown;
    texts?: { key: string; lang: string; value: string }[];
  }) => void;
  /**
   * Edits one chain slot of a Document (`chainSlots` of its kind, a Trigger's `do`) in
   * place: `edit` mutates the slot's Step[] and releases, through `gc`, the texts of the
   * steps it drops; the slot's texts are then minted at its prefix in `lang`.
   */
  editDocumentChain: (input: {
    projectId: ProjectId;
    kind: string;
    id: string;
    slot: string;
    lang: string;
    edit: (steps: Step[], gc: (dropped: Step[]) => void) => void;
  }) => void;
  /**
   * Reads the Documents of a kind registered after the Project was read (a module's view
   * that arrived with the presence): its folder was kept verbatim until now. Changes
   * nothing on disk, so the Project is not marked edited.
   */
  adoptLateDocuments: (input: { projectId: ProjectId }) => void;
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
}: ProjectsSliceContext): DocumentsSlice => ({
  createDocument: ({ projectId: pId, kind, id, position }) => {
    const contribution = documentKindContribution(kind);
    if (!contribution) throw new Error(`no module contributes the document kind "${kind}"`);
    const project = get().openProjects.projects.find((p) => p.id === pId);
    if (!project) throw new Error("project not found");
    if (hasDocument(project, id)) throw new Error(`document id "${id}" already exists`);
    mutateProject(pId, (p) => {
      const doc = createDocumentOfKind(contribution, id, pId);
      mutableDocuments(p, kind).push(doc);
      mintLTexts(p, documentLTextSites(kind, doc), p.defaultLang);
      if (position) {
        p.canvasLayout[docKey(kind, id)] = position;
      }
    });
    return id;
  },
  updateDocument: ({ projectId: pId, kind, id, doc, texts }) =>
    mutateProject(pId, (p) => {
      const docs = mutableDocuments(p, kind);
      const index = docs.findIndex((d) => d.id === id);
      if (index < 0) return false;
      docs[index] = doc as (typeof docs)[number];
      for (const t of texts ?? []) setLText(p, { key: t.key as I18nKey }, t.lang, t.value);
    }),
  editDocumentChain: ({ projectId: pId, kind, id, slot, lang, edit }) =>
    mutateProject(pId, (p) => {
      const doc = documentsOf(p, kind).find((d) => d.id === id);
      if (!doc) return false;
      const chain = [...documentChainSlots(kind, doc)].find((c) => c.name === slot);
      if (!chain) return false;
      const project = p as Project;
      edit(chain.steps, (dropped) => gcStepLTexts(project, dropped));
      allocStepLTexts(project, chain.steps, lang, chain.prefix);
    }),
  adoptLateDocuments: ({ projectId: pId }) =>
    mutateProject(
      pId,
      (p) => {
        adoptLateDocuments(p);
      },
      { touch: false },
    ),
  setDocumentId: ({ projectId: pId, kind, oldId, newId }) => {
    if (oldId === newId) return;
    if (!newId) throw new Error("document id cannot be empty");
    const project = get().openProjects.projects.find((p) => p.id === pId);
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
      renameBoardKey(p, kind, oldId, newId);
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
    const moved = renamedDocumentFiles(
      get().openProjects.projects.find((p) => p.id === pId),
      kind,
      oldId,
      newId,
    );
    useProjectDraftStore.getState().recordRename(pId, moved.from, moved.to);
  },
});
