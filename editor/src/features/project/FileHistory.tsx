import { type FileVersion, readFileHistory } from "@/lib/api/projectFiles";
import { projectClient } from "@/lib/projectClient";
import { useState } from "react";
import { useTranslation } from "react-i18next";

/**
 * A file's trash (ADR `server-disk-only-storage` decision 5): the versions the
 * plugin archived before each overwrite, most recent first.
 *
 * This is **not** a project history: a file is restored, never a point in
 * time. "Put this menu back as it was" works; "put everything back to last
 * night" does not exist, by design.
 *
 * Restore = put the content back in the editor, then save normally. No
 * privileged write path: a restore goes through the same compare-and-swap as
 * everything else, so it cannot overwrite behind someone's back.
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
