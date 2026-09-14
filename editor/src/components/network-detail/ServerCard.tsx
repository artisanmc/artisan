import { displayServerLabel } from "@/lib/serverLabel";
import { projectUrlId } from "@/lib/projectUrlId";
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
interface Project {
  id: string;
  externalId?: string | null;
  name: string;
}

interface Props {
  /** Real network id — workspace links stay id-based (the canvas route + its
   *  deploy/history children need the real id, not a slug — see phase 4b). */
  networkId: string;
  server: Server;
  workspaces: Project[];
  onAction: (
    action: "edit" | "relink" | "history" | "allowlist" | "delete",
    serverId: string,
  ) => void;
  onCreateProject: (serverId: string) => void;
}

export function ServerCard({ networkId, server, workspaces, onAction, onCreateProject }: Props) {
  const { t } = useTranslation();
  return (
    <div className="card flex flex-col gap-3 p-4">
      <div className="flex items-center justify-between gap-3">
        <div className="flex min-w-0 items-center gap-2">
          <span
            className="h-2 w-2 shrink-0 rounded-full"
            title={server.online ? t("serverCard.online") : t("serverCard.offline")}
            aria-label={server.online ? t("serverCard.online") : t("serverCard.offline")}
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

      {/* Hors ligne, on ne compte rien : la liste des Projects vient du disque du
          serveur, et personne n'est au bout du fil. « 0 projet » ferait croire
          qu'il n'en a pas, alors qu'on ne peut pas savoir. */}
      <p className="text-[11.5px] text-[var(--text-faint)]">
        {server.online
          ? t("serverCard.projectCount", { count: workspaces.length })
          : t("serverCard.offlineProjects")}
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
            to="/networks/$networkId/servers/$serverId/projects/$projectId"
            params={{ networkId, serverId: server.slug ?? server.id, projectId: projectUrlId(w) }}
            className="group flex items-center justify-between gap-2 rounded-[8px] px-2 py-1.5 transition-colors hover:bg-[var(--surface-hover)]"
          >
            <span className="truncate text-[12.5px] text-[var(--text-mut)] group-hover:text-[var(--text)]">
              📋 {w.name}
            </span>
            {/* Plus de compteur de Documents ici : le backend ne détient plus
                les fichiers (ADR `server-disk-only-storage`) et ne peut donc
                plus le connaître. La sidebar d'un Project ouvert en affiche un,
                lui — il se compte sur l'état chargé, donc il est vrai. */}
            <ArrowRight className="size-[13px] shrink-0 text-[var(--text-faint)]" />
          </Link>
        ))}
        <button
          type="button"
          onClick={() => onCreateProject(server.id)}
          className="flex items-center gap-1.5 rounded-[8px] px-2 py-1.5 text-left text-[12px] text-[var(--text-mut)] hover:bg-[var(--surface-hover)] hover:text-[var(--text)]"
        >
          + {t("serverCard.newProject")}
        </button>
      </div>
    </div>
  );
}
