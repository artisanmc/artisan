import { type FileVersion, readFileHistory } from "@/lib/api/projectFiles";
import { projectClient } from "@/lib/projectClient";
import { useState } from "react";
import { useTranslation } from "react-i18next";

/**
 * La corbeille d'un fichier (ADR `server-disk-only-storage` décision 5) : les
 * versions que le plugin a archivées avant chaque écrasement, la plus récente
 * d'abord.
 *
 * Ce n'est **pas** un historique de projet : on restaure un fichier, jamais un
 * point dans le temps. « Remets ce menu comme il était » marche ; « remets tout
 * à hier soir » n'existe pas, et c'est assumé.
 *
 * Restaurer = remettre le contenu dans l'éditeur, puis enregistrer normalement.
 * Aucun chemin d'écriture privilégié : une restauration passe par le même
 * compare-and-swap que le reste, donc elle ne peut pas écraser dans le dos de
 * quelqu'un.
 */
export function FileHistory({
  networkId,
  serverId,
  diskId,
  path,
  onRestore,
  projectId,
}: {
  projectId?: string;
  networkId?: string;
  serverId?: string;
  diskId?: string;
  path: string;
  onRestore: (content: string) => void;
}) {
  const { t } = useTranslation();
  const [versions, setVersions] = useState<FileVersion[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  const load = async () => {
    setLoading(true);
    setError(null);
    const res = projectId
      ? await projectClient(projectId).history(path)
      : await readFileHistory(networkId!, serverId, diskId, path);
    setLoading(false);
    if (!res.ok) {
      setError(res.error === "server_offline" ? t("history.serverOffline") : t("history.failed"));
      setVersions(null);
      return;
    }
    setVersions(res.versions);
  };

  if (versions === null) {
    return (
      <div className="flex items-center gap-2">
        <button type="button" className="btn btn-sm btn-ghost" onClick={load} disabled={loading}>
          {loading ? t("history.loading") : t("history.show")}
        </button>
        {error ? <span className="text-[11px] text-rose-300">{error}</span> : null}
      </div>
    );
  }

  if (versions.length === 0) {
    return <p className="text-[11px] text-[var(--text-faint)]">{t("history.empty")}</p>;
  }

  return (
    <div className="flex flex-col gap-1">
      <p className="field-label">{t("history.title")}</p>
      <ul className="flex flex-col gap-1">
        {versions.map((v) => (
          <li key={v.at} className="flex items-center gap-2">
            <span className="font-mono text-[11px] text-[var(--text-mut)]">
              {new Date(v.at).toLocaleString()}
              {"author" in v ? ` · ${v.author?.name ?? t("history.byServer")}` : null}
            </span>
            <button
              type="button"
              className="btn btn-sm btn-ghost"
              onClick={() => onRestore(v.content)}
            >
              {t("history.restore")}
            </button>
          </li>
        ))}
      </ul>
      <p className="text-[11px] text-[var(--text-faint)]">{t("history.restoreHint")}</p>
    </div>
  );
}
