import { Tooltip } from "@/components/ui/tooltip";
import type { ModuleCommandNode } from "@/features/canvas/moduleCommands";
import { useSystemCommandsStore } from "@/state/systemCommandsStore";
import { Link, useParams } from "@tanstack/react-router";
import { Puzzle } from "lucide-react";
import { useTranslation } from "react-i18next";

/**
 * A command the folder's module declares, listed with the folder's own commands: the
 * puzzle marks it as the module's (its behaviour lives in the plugin, explained on hover),
 * a dot when the admin changed it, struck when disabled. It opens its System page.
 */
export function ModuleCommandRow({
  node,
  depth = 0,
}: {
  node: ModuleCommandNode;
  /** Folder depth: 0 under the kind header at the module root. */
  depth?: number;
}) {
  const { t } = useTranslation();
  const serverId = useSystemCommandsStore((s) => s.serverId);
  const params = useParams({ strict: false }) as { commandId?: string };
  if (!serverId) return null;
  const active = params.commandId === node.id;
  const hint = t("projectPanel.moduleCommandHint", { module: node.moduleId });
  return (
    <Link
      to="/servers/$serverId/commands/$commandId"
      params={{ serverId, commandId: node.id }}
      className={`flex min-w-0 items-center gap-1.5 rounded-[10px] py-1 pr-2 text-left text-[12.5px] leading-5 hover:bg-[var(--surface-hover)] ${
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
    </Link>
  );
}
