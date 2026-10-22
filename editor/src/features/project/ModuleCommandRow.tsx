import { Tooltip } from "@/components/ui/tooltip";
import type { ModuleCommandNode } from "@/lib/moduleCommands";
import { useSelectionStore } from "@/state/selectionStore";
import { Puzzle } from "lucide-react";
import { useTranslation } from "react-i18next";

/**
 * A command the folder's module declares, listed with the folder's own commands: the
 * puzzle marks it as the module's (its behaviour lives in the plugin, explained on hover),
 * a dot when the admin changed it, struck when disabled. Like a Document, it opens on the
 * board, selected, its form in the Properties panel.
 */
export function ModuleCommandRow({
  node,
  onOpen,
  depth = 0,
}: {
  node: ModuleCommandNode;
  onOpen: () => void;
  /** Folder depth: 0 under the kind header at the module root. */
  depth?: number;
}) {
  const { t } = useTranslation();
  const active = useSelectionStore((s) => s.menuId === null && s.ids.has(node.id));
  const hint = t("projectPanel.moduleCommandHint", { module: node.moduleId });
  return (
    <button
      type="button"
      onClick={onOpen}
      className={`flex w-full min-w-0 items-center gap-1.5 rounded-[10px] py-1 pr-2 text-left text-[12.5px] leading-5 hover:bg-[var(--surface-hover)] ${
        active
          ? "font-semibold text-[var(--text)]"
          : "text-[var(--text-mut)] hover:text-[var(--text)]"
      }`}
      style={{ paddingLeft: 24 + depth * 12 }}
    >
      <span
        className={
          node.state === "disabled" ? "flex-1 truncate line-through opacity-60" : "flex-1 truncate"
        }
      >
        /{node.label}
      </span>
      {node.state === "modified" && (
        <span
          role="img"
          aria-label={t("systemCommands.stateModified")}
          title={t("systemCommands.stateModified")}
          className="size-1.5 shrink-0 rounded-full bg-[var(--brand)]"
        />
      )}
      <Tooltip content={hint} side="right">
        <span role="img" aria-label={hint} className="flex shrink-0">
          <Puzzle className="size-3 text-[var(--text-faint)]" aria-hidden />
        </span>
      </Tooltip>
    </button>
  );
}
