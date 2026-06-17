import { displayServerLabel } from "@/lib/serverLabel";
import { Link } from "@tanstack/react-router";
import { ArrowRight } from "lucide-react";
import { useTranslation } from "react-i18next";
import { ServerKebabMenu } from "./ServerKebabMenu";

interface Server {
  id: string;
  slug: string;
  label: string | null;
  online: boolean;
  lastSeen?: string | null;
}
interface Workspace {
  id: string;
  name: string;
  /** Menus + commands + dialogs count, for the element-count indicator. */
  elementCount?: number;
}

interface Props {
  /** Real network id — workspace links stay id-based (the canvas route + its
   *  deploy/history children need the real id, not a slug — see phase 4b). */
  networkId: string;
  server: Server;
  workspaces: Workspace[];
  onAction: (
    action: "edit" | "show-key" | "rotate" | "history" | "allowlist" | "delete",
    serverId: string,
  ) => void;
  onCreateWorkspace: (serverId: string) => void;
}

export function ServerCard({ networkId, server, workspaces, onAction, onCreateWorkspace }: Props) {
  const { t } = useTranslation();
  return (
    <div className="card flex flex-col gap-3 p-4">
      <div className="flex items-center justify-between gap-3">
        <div className="flex min-w-0 items-center gap-2">
          <span
            className="h-2 w-2 shrink-0 rounded-full"
            style={{
              background: server.online ? "var(--success)" : "var(--text-faint)",
              boxShadow: server.online ? "0 0 6px var(--success)" : "none",
            }}
          />
          <span className="truncate text-[14px] font-semibold text-[var(--text)]">
            {displayServerLabel(server)}
          </span>
        </div>
        <ServerKebabMenu serverId={server.id} onAction={onAction} />
      </div>

      <p className="text-[11.5px] text-[var(--text-faint)]">
        {t("serverCard.workspaceCount", { count: workspaces.length })}
        {!server.online && server.lastSeen && (
          <>
            {" · "}
            {t("serverCard.lastConnected", { ago: server.lastSeen })}
          </>
        )}
      </p>

      <div className="flex flex-col gap-1 border-t border-[var(--border-soft)] pt-2.5">
        {workspaces.map((w) => (
          <Link
            key={w.id}
            to="/networks/$networkId/servers/$serverId/workspaces/$workspaceId"
            params={{ networkId, serverId: server.id, workspaceId: w.id }}
            className="group flex items-center justify-between gap-2 rounded-[8px] px-2 py-1.5 transition-colors hover:bg-[var(--surface-hover)]"
          >
            <span className="truncate text-[12.5px] text-[var(--text-mut)] group-hover:text-[var(--text)]">
              📋 {w.name}
            </span>
            <div className="flex shrink-0 items-center gap-1.5">
              {w.elementCount != null && (
                <span
                  title={t("serverDetail.elementCount", { count: w.elementCount })}
                  aria-label={t("serverDetail.elementCount", { count: w.elementCount })}
                  className="rounded-full bg-[var(--surface-raised)] px-1.5 text-[10px] font-medium tabular-nums text-[var(--text-faint)]"
                >
                  {w.elementCount}
                </span>
              )}
              <ArrowRight className="size-[13px] text-[var(--text-faint)]" />
            </div>
          </Link>
        ))}
        <button
          type="button"
          onClick={() => onCreateWorkspace(server.id)}
          className="flex items-center gap-1.5 rounded-[8px] px-2 py-1.5 text-left text-[12px] text-[var(--text-mut)] hover:bg-[var(--surface-hover)] hover:text-[var(--text)]"
        >
          + {t("serverCard.newWorkspace")}
        </button>
      </div>
    </div>
  );
}
