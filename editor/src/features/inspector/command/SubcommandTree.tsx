import { Switch } from "@/components/ui/switch";
import { walkCommandNodes } from "@/domain/commandNodes";
import type { Command, CommandNodePath, ProjectId } from "@/domain/types";
import { cx } from "@/lib/cx";
import { useProjectsStore } from "@/state/projectsStore";
import { useTranslation } from "react-i18next";

const samePath = (a: CommandNodePath, b: CommandNodePath) =>
  a.length === b.length && a.every((v, i) => v === b[i]);

/**
 * The command and its sub-commands as typed (`/ah`, `/ah sell`), one row each, indented
 * by depth. A row selects the node the panels beside it edit; its switch turns it off
 * (`enabled: false`) without deleting it.
 */
export function SubcommandTree({
  projectId,
  command,
  selected,
  onSelect,
}: {
  projectId: ProjectId;
  command: Command;
  selected: CommandNodePath;
  onSelect: (path: CommandNodePath) => void;
}) {
  const { t } = useTranslation();
  const setCommandEnabled = useProjectsStore((s) => s.setCommandEnabled);
  const addSubcommand = useProjectsStore((s) => s.addSubcommand);
  const removeSubcommand = useProjectsStore((s) => s.removeSubcommand);
  const nodes = [...walkCommandNodes(command)];
  // A node is off when it or a parent is: its words are unreachable in game.
  const offPaths = nodes.filter((v) => v.node.enabled === false).map((v) => v.path);
  const isOff = (path: number[]) =>
    offPaths.some((off) => off.length <= path.length && off.every((v, i) => v === path[i]));
  const siblingsNamed = (path: number[], name: string) => {
    const parent = nodes.find((v) => samePath(v.path, path.slice(0, -1)))?.node;
    return (parent?.subcommands ?? []).filter((c) => c.name === name).length;
  };

  return (
    <div className="flex flex-col gap-1">
      <p className="text-[12px] text-[var(--text-faint)]">{t("command.subcommandsHint")}</p>
      <ul className="flex flex-col gap-0.5">
        {nodes.map(({ node, path, words }) => {
          const isSelected = samePath(path, selected);
          const invalid =
            path.length > 0 &&
            (!/^[a-z][a-z0-9_-]{0,31}$/.test(node.name) || siblingsNamed(path, node.name) > 1);
          return (
            // The whole row selects its node; the switch and the remove button keep
            // their click to themselves. The row's button takes the keyboard.
            // biome-ignore lint/a11y/useKeyWithClickEvents: the row's button handles keys
            <li
              key={path.join(".") || "root"}
              onClick={() => onSelect(path)}
              className={cx(
                "flex cursor-pointer items-center gap-2 rounded-[var(--r-xs)] border px-2 py-1",
                isSelected
                  ? "border-[var(--kind-command-line)] bg-[var(--kind-command-soft)]"
                  : "border-transparent hover:bg-[var(--surface-hover)]",
              )}
              style={{ paddingLeft: `${0.5 + path.length * 1}rem` }}
            >
              <button
                type="button"
                className={cx(
                  "min-w-0 flex-1 cursor-pointer truncate text-left font-mono text-[12.5px]",
                  isOff(path) ? "text-[var(--text-faint)] line-through" : "text-[var(--text)]",
                  invalid && "text-[var(--danger)]",
                )}
                title={invalid ? t("command.subcommandNameInvalid") : undefined}
              >
                /{words.join(" ")}
              </button>
              {node.steps.length === 0 && (node.subcommands?.length ?? 0) > 0 ? (
                <span className="shrink-0 text-[11px] text-[var(--text-faint)]">
                  {t("command.groupBadge")}
                </span>
              ) : null}
              {/* biome-ignore lint/a11y/useKeyWithClickEvents: only stops the row's click */}
              <span className="flex" onClick={(e) => e.stopPropagation()}>
                <Switch
                  checked={node.enabled !== false}
                  aria-label={t("command.enabledLabel")}
                  title={t("command.enabledLabel")}
                  onCheckedChange={(enabled) =>
                    setCommandEnabled({ projectId, commandId: command.id, sub: path, enabled })
                  }
                />
              </span>
              {path.length > 0 ? (
                <button
                  type="button"
                  title={t("command.removeSubcommand")}
                  onClick={(e) => {
                    e.stopPropagation();
                    removeSubcommand({ projectId, commandId: command.id, sub: path });
                    // The selection moves to the removed node's parent.
                    if (selected.length >= path.length && path.every((v, i) => v === selected[i]))
                      onSelect(path.slice(0, -1));
                  }}
                  className="flex h-6 w-6 items-center justify-center rounded text-[14px] text-[var(--text-faint)] hover:bg-[var(--surface-hover)] hover:text-[var(--text)]"
                >
                  ×
                </button>
              ) : (
                <span className="w-6" />
              )}
            </li>
          );
        })}
      </ul>
      <button
        type="button"
        onClick={() => {
          const added = addSubcommand({ projectId, commandId: command.id, sub: selected });
          if (added) onSelect(added);
        }}
        className="self-start rounded-[var(--r-xs)] border border-[var(--border)] border-dashed px-3 py-1.5 text-[12px] text-[var(--text-mut)] hover:border-[var(--border-strong)] hover:text-[var(--text)]"
      >
        {t("command.addSubcommand")}
      </button>
    </div>
  );
}
