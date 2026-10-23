import { Badge } from "@/components/ui/badge";
import { IconTile } from "@/components/ui/icon-tile";
import { Tooltip } from "@/components/ui/tooltip";
import { kindAppearance } from "@/lib/documentKindAppearance";
import type { ModuleCommandNode, ModuleSubCommand } from "@/lib/moduleCommands";
import { useSelectionStore } from "@/state/selectionStore";
import { ChevronDown, ChevronRight, Puzzle } from "lucide-react";
import { useState } from "react";
import { useTranslation } from "react-i18next";

/**
 * A command the folder's module declares, listed with the folder's own commands: the
 * puzzle marks it as the module's (its behaviour lives in the plugin, explained on hover),
 * a dot when the admin changed it, struck when disabled. Like a Document, it opens on the
 * board, selected, its form in the Properties panel. Its sub-commands fold under it, as
 * they are rows of its node.
 */
export function ModuleCommandRow({
  node,
  onOpen,
  depth = 0,
}: {
  node: ModuleCommandNode;
  /** Opens the command, or the sub-command [id] when given. */
  onOpen: (id?: string) => void;
  /** Folder depth: 0 at the module root. */
  depth?: number;
}) {
  const { t } = useTranslation();
  const active = useSelectionStore((s) => s.menuId === null && s.ids.has(node.id));
  const activeChild = useSelectionStore((s) =>
    s.menuId === node.id && s.ids.size === 1 ? [...s.ids][0]! : null,
  );
  const [expanded, setExpanded] = useState(activeChild !== null);
  const hint = t("projectPanel.moduleCommandHint", { module: node.moduleId });
  const Chevron = expanded ? ChevronDown : ChevronRight;
  return (
    <>
      <Row
        active={active}
        label={`/${node.label}`}
        state={node.state}
        depth={depth}
        onOpen={() => onOpen()}
        hint={hint}
        trailing={
          node.children.length > 0 ? (
            <button
              type="button"
              aria-expanded={expanded}
              aria-label={t(
                expanded ? "projectPanel.foldSubCommands" : "projectPanel.unfoldSubCommands",
                {
                  command: `/${node.label}`,
                },
              )}
              onClick={() => setExpanded((v) => !v)}
              className="relative shrink-0 px-2 py-1 text-[var(--text-faint)] hover:text-[var(--text)]"
            >
              {/* The width of a Document's "···": the puzzles stay in line. */}
              <span aria-hidden className="invisible">
                ···
              </span>
              <Chevron className="absolute inset-0 m-auto size-3.5" aria-hidden />
            </button>
          ) : null
        }
      />
      {expanded &&
        node.children.map((child) => (
          <SubCommandRow
            key={child.id}
            child={child}
            active={activeChild === child.id}
            depth={depth + child.depth}
            onOpen={() => onOpen(child.id)}
            hint={hint}
          />
        ))}
    </>
  );
}

function SubCommandRow({
  child,
  active,
  depth,
  onOpen,
  hint,
}: {
  child: ModuleSubCommand;
  active: boolean;
  depth: number;
  onOpen: () => void;
  hint: string;
}) {
  return (
    <Row
      active={active}
      label={child.label}
      state={child.state}
      depth={depth}
      onOpen={onOpen}
      hint={hint}
      trailing={null}
    />
  );
}

function Row({
  active,
  label,
  state,
  depth,
  onOpen,
  hint,
  trailing,
}: {
  active: boolean;
  label: string;
  state: ModuleCommandNode["state"];
  depth: number;
  onOpen: () => void;
  hint: string;
  trailing: React.ReactNode;
}) {
  const { t } = useTranslation();
  const look = kindAppearance("command");
  return (
    // Same frame as a Document's row, its actions' room kept empty: the puzzles line up.
    <div
      className={`flex items-center gap-0.5 rounded-[10px] ${
        active ? "bg-[var(--kind-command-soft)]" : "hover:bg-[var(--surface-hover)]"
      }`}
    >
      <button
        type="button"
        onClick={onOpen}
        className={`flex min-w-0 flex-1 items-center gap-2 rounded-[10px] py-[5px] pr-2 text-left text-[13px] leading-5 text-[var(--text)] ${
          active ? "font-semibold" : ""
        }`}
        style={{ paddingLeft: 6 + depth * 14 }}
      >
        <span className="flex shrink-0" aria-hidden>
          <IconTile icon={look.icon} fg={look.fg} soft={look.soft} size="xs" />
        </span>
        <span
          className={
            state === "disabled" ? "flex-1 truncate line-through opacity-60" : "flex-1 truncate"
          }
        >
          {label}
        </span>
        {state === "modified" && (
          <Badge
            variant="terra"
            role="img"
            aria-label={t("systemCommands.stateModified")}
            title={t("systemCommands.stateModified")}
            className="shrink-0 !h-[17px] !px-1.5 text-[10.5px]"
          >
            {t("projectPanel.originTag.modified")}
          </Badge>
        )}
        <Tooltip content={hint} side="right">
          <span role="img" aria-label={hint} className="flex shrink-0">
            <Puzzle className="size-3 text-[var(--text-faint)]" aria-hidden />
          </span>
        </Tooltip>
      </button>
      {trailing ?? (
        <span aria-hidden className="invisible shrink-0 px-2 py-1">
          ···
        </span>
      )}
    </div>
  );
}
