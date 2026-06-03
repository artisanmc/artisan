import { Link } from "@tanstack/react-router";
import { ArrowRight } from "lucide-react";
import { useTranslation } from "react-i18next";
import { ServerKebabMenu } from "./ServerKebabMenu";

interface Server { id: string; label: string | null; online: boolean; lastSeen?: string | null; }
interface Workspace { id: string; name: string; }

interface Props {
  server: Server;
  workspaces: Workspace[];
  onAction: (action: "show-key" | "rotate" | "history" | "allowlist" | "delete", serverId: string) => void;
  onCreateWorkspace: (serverId: string) => void;
}

export function ServerCard({ server, workspaces, onAction, onCreateWorkspace }: Props) {
  const { t } = useTranslation();
  return (
    <div className="card flex flex-col gap-3 p-4">
      <div className="flex items-center justify-between gap-3">
        <div className="flex min-w-0 items-center gap-2">
          <span
            className="h-2 w-2 shrink-0 rounded-full"
            style={{
              background: server.online ? "var(--sage)" : "var(--ink-faint)",
              boxShadow: server.online ? "0 0 6px var(--sage)" : "none",
            }}
          />
          <span className="truncate text-[14px] font-semibold text-[var(--ink)]">
            {server.label ?? server.id.slice(0, 12)}
          </span>
        </div>
        <ServerKebabMenu serverId={server.id} onAction={onAction} />
      </div>

      <p className="text-[11.5px] text-[var(--ink-faint)]">
        {t("serverCard.workspaceCount", { count: workspaces.length })}
        {!server.online && server.lastSeen && (
          <>
            {" · "}
            {t("serverCard.lastConnected", { ago: server.lastSeen })}
          </>
        )}
      </p>

      <div className="flex flex-col gap-1 border-t border-[var(--line-soft)] pt-2.5">
        {workspaces.map((w) => (
          <Link
            key={w.id}
            to="/workspace/$workspaceId"
            params={{ workspaceId: w.id }}
            className="group flex items-center justify-between gap-2 rounded-[8px] px-2 py-1.5 transition-colors hover:bg-[var(--hover)]"
          >
            <span className="truncate text-[12.5px] text-[var(--ink-2)] group-hover:text-[var(--ink)]">
              📋 {w.name}
            </span>
            <ArrowRight className="size-[13px] text-[var(--ink-faint)]" />
          </Link>
        ))}
        <button
          type="button"
          onClick={() => onCreateWorkspace(server.id)}
          className="flex items-center gap-1.5 rounded-[8px] px-2 py-1.5 text-left text-[12px] text-[var(--ink-mut)] hover:bg-[var(--hover)] hover:text-[var(--ink)]"
        >
          + {t("serverCard.newWorkspace")}
        </button>
      </div>
    </div>
  );
}
