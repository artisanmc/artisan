import { documentsOf, menusOf } from "@/domain/documents";
import type { Command, Dialog, Menu, ProjectId } from "@/domain/types";
import { selectionContext } from "@/features/project/selectionContext";
import { useAccountStore } from "@/state/accountStore";
import { useFlowSelectionStore } from "@/state/flowSelectionStore";
import { useSelectionStore } from "@/state/selectionStore";
import { documentKindContribution } from "@artisan/editor-sdk";
import { useEffect } from "react";
import { useTranslation } from "react-i18next";
import { CommandEditor } from "./command/CommandEditor";
import { DialogEditor } from "./dialog/DialogEditor";
import { ElementEditor } from "./element/ElementEditor";
import { MenuProperties } from "./properties/MenuProperties";
import { ProjectProperties } from "./properties/ProjectProperties";

interface SelectionInspectorProps {
  projectId: ProjectId;
}

/**
 * Unified editor for the current selection. Routes by kind:
 *   Project         → project-level fields (description, source).
 *   Menu            → title / permission / rows / background.
 *   Element         → identity + per-state cards (with all state-level
 *                     fields embedded) + click handlers for the focused state.
 *   Command         → command identity + step tree.
 *
 * Everything for the current selection is rendered together so users always
 * see how state-level fields (title, count, lore, conditions) and click
 * handlers belong to a specific state card.
 */
export function SelectionInspector({ projectId }: SelectionInspectorProps) {
  const { t } = useTranslation();
  const ids = useSelectionStore((s) => s.ids);
  const selectionMenuId = useSelectionStore((s) => s.menuId);
  const project = useAccountStore((s) => s.account.projects.find((p) => p.id === projectId));
  const setSub = useFlowSelectionStore((s) => s.set);

  // biome-ignore lint/correctness/useExhaustiveDependencies: ids change is the trigger
  useEffect(() => {
    setSub(null);
  }, [setSub, [...ids].sort().join(",")]);

  if (!project) return <EmptyHint label={t("projectNotFound")} />;

  // The kind of selection is derived ONCE (`selectionContext`) and shared with
  // the panel's tab gating: two separate dispatches would end up disagreeing.
  const ctx = selectionContext(project, ids, selectionMenuId);

  switch (ctx.kind) {
    case "multi":
      return <EmptyHint label="Multi-edit not supported in v1. Select one item." />;
    case "none":
      return (
        <div className="h-full overflow-y-auto p-3">
          <ProjectProperties project={project} />
        </div>
      );
    case "command":
    case "dialog":
    case "menu":
    case "document": {
      // The Properties panel shows the `component` of the selected Document's kind, read
      // from the kind registry (ADR `extensible-document-kinds`, lot 5). The core kinds
      // register theirs like a module would; when their modules are not registered (a
      // surface rendered on its own), their built-in editors still answer.
      const kind =
        ctx.kind === "menu" ? "menu" : ctx.kind === "document" ? ctx.documentKind : ctx.kind;
      const id = ctx.kind === "menu" ? ctx.menuId : ctx.id;
      const doc = documentsOf(project, kind).find((d) => d.id === id);
      if (!doc) return <EmptyHint label={t("projectPanel.noEditor", { kind })} />;
      const View = documentKindContribution(kind)?.component;
      if (View) {
        return (
          <div className="h-full min-h-0 overflow-y-auto">
            <View projectId={projectId} documentId={id} document={doc} />
          </div>
        );
      }
      if (kind === "command") {
        return (
          <div className="h-full overflow-hidden">
            <CommandEditor projectId={projectId} command={doc as Command} />
          </div>
        );
      }
      if (kind === "dialog") {
        return (
          <div className="h-full overflow-hidden">
            <DialogEditor projectId={projectId} dialog={doc as Dialog} />
          </div>
        );
      }
      if (kind === "menu") {
        return (
          <div className="h-full overflow-y-auto p-3">
            <MenuProperties projectId={projectId} menu={doc as Menu} />
          </div>
        );
      }
      return <EmptyHint label={t("projectPanel.noEditor", { kind })} />;
    }
    case "element": {
      const menu = menusOf(project).find((m) => m.id === ctx.menuId)!;
      const el = menu.layers.flatMap((l) => l.elements).find((e) => e.id === ctx.elementId)!;
      return (
        <div className="h-full overflow-hidden">
          <ElementEditor projectId={projectId} menu={menu} element={el} />
        </div>
      );
    }
    default:
      return <EmptyHint label="Selection has no editor." />;
  }
}

function EmptyHint({ label }: { label: string }) {
  return (
    <div className="flex h-full items-center justify-center bg-[var(--surface)] text-xs text-[var(--text-faint)]">
      {label}
    </div>
  );
}
