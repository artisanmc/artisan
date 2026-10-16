import { DIALOG_KIND } from "@/domain/documentKinds";
import { dialogChainSlots, visitDialogLTexts } from "@/domain/i18nSites";
import type { Dialog, DialogId, I18nKey, Project, ProjectId } from "@/domain/types";
import { DialogEditor } from "@/features/inspector/dialog/DialogEditor";
import { getText } from "@/lib/i18n";
import { dialogV1FromDomain } from "@/schema/dialogV1FromDomain";
import { dialogV1ToDomain } from "@/schema/dialogV1ToDomain";
import type { DocumentParseOpts } from "@/schema/documentCodecs";
import type { DocumentEditorProps, DocumentKindContribution } from "@artisan/editor-sdk";
import { MessageSquare } from "lucide-react";

function DialogView({ projectId, document }: DocumentEditorProps) {
  return <DialogEditor projectId={projectId as ProjectId} dialog={document as Dialog} />;
}

/** The dialog kind, declared like a module's (ADR `extensible-document-kinds`, lot 5). */
export const dialogKind: DocumentKindContribution = {
  ...DIALOG_KIND,
  label: "projectPanel.dialogs",
  icon: MessageSquare,
  component: DialogView,
  title: (doc, { project, lang }) => getText(project as Project, (doc as Dialog).title, lang),
  create: ({ id, projectId }) =>
    ({
      id: id as DialogId,
      projectId: projectId as ProjectId,
      // Empty keys: the host allocates `dialogs.<id>.title` and the button label.
      title: { key: "" as I18nKey },
      canCloseWithEscape: true,
      body: [],
      inputs: [],
      buttons: [{ id: "btn_confirm", label: { key: "" as I18nKey }, steps: [] }],
    }) satisfies Dialog,
  parse: (src, ctx) => {
    const r = dialogV1ToDomain(src, ctx as DocumentParseOpts);
    return { doc: r.dialog, i18nKeys: r.i18nKeys, unsupported: r.unsupported };
  },
  serialize: (doc, project) => dialogV1FromDomain(doc as Dialog, project as Project),
  ltextSites: (doc) => visitDialogLTexts(doc as Dialog),
  chainSlots: (doc) => dialogChainSlots(doc as Dialog),
};
