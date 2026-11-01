import type { ProjectId } from "@/domain/types";
import type { DocumentEditorProps, DocumentKindContribution } from "@artisan/editor-sdk";
import i18next from "i18next";
import { Variable as VariableIcon } from "lucide-react";
import { VariableEditor } from "./VariableEditor";
import { VARIABLE_KIND, type Variable, variableFromFile, variableToFile } from "./variable";

function VariableView({ projectId, document }: DocumentEditorProps) {
  return <VariableEditor projectId={projectId as ProjectId} variable={document as Variable} />;
}

/** The Variable kind (ADR `triggers-and-variables` §5), declared like a module's. */
export const variableKind: DocumentKindContribution = {
  ...VARIABLE_KIND,
  label: "projectPanel.variables",
  icon: VariableIcon,
  component: VariableView,
  ownHeader: true,
  create: ({ id, projectId }) =>
    ({ id, projectId: projectId as ProjectId, scope: "player", type: "string" }) satisfies Variable,
  parse: (src, ctx) => ({
    doc: variableFromFile(src, ctx.projectId),
    i18nKeys: {},
    unsupported: [],
  }),
  serialize: (doc) => variableToFile(doc as Variable),
  board: {
    summary: (doc) => {
      const v = doc as Variable;
      return i18next.t("variables.summary", {
        type: i18next.t(`variables.types.${v.type}`),
        scope: i18next.t(`variables.scopes.${v.scope}`),
      });
    },
    accent: "var(--kind-variable)",
  },
};
