import { COMMAND_KIND } from "@/domain/documentKinds";
import { commandChainSlots, visitCommandLTexts } from "@/domain/i18nSites";
import type { Command, CommandId, Project, ProjectId } from "@/domain/types";
import { CommandEditor } from "@/features/inspector/command/CommandEditor";
import { commandV1FromDomain } from "@/schema/commandV1FromDomain";
import { commandV1ToDomain } from "@/schema/commandV1ToDomain";
import type { DocumentParseOpts } from "@/schema/documentCodecs";
import type { DocumentEditorProps, DocumentKindContribution } from "@artisan/editor-sdk";
import { TerminalSquare } from "lucide-react";

function CommandView({ projectId, document }: DocumentEditorProps) {
  return <CommandEditor projectId={projectId as ProjectId} command={document as Command} />;
}

/** The command kind, declared like a module's (ADR `extensible-document-kinds`, lot 5). */
export const commandKind: DocumentKindContribution = {
  ...COMMAND_KIND,
  label: "projectPanel.commands",
  icon: TerminalSquare,
  component: CommandView,
  ownHeader: true,
  title: (doc) => `/${(doc as Command).name}`,
  listByTitle: true,
  create: ({ id, projectId }) =>
    ({
      id: id as CommandId,
      projectId: projectId as ProjectId,
      name: "newcmd",
      arguments: [],
      steps: [],
    }) satisfies Command,
  parse: (src, ctx) => {
    const r = commandV1ToDomain(src, ctx as DocumentParseOpts);
    return { doc: r.command, i18nKeys: r.i18nKeys, unsupported: r.unsupported };
  },
  serialize: (doc, project) => commandV1FromDomain(doc as Command, project as Project),
  ltextSites: (doc) => visitCommandLTexts(doc as Command),
  chainSlots: (doc) => commandChainSlots(doc as Command),
};
