import { Button } from "@/components/ui/button";
import { getEditorAccess, type EditorAccessDto } from "@/lib/api/projectFiles";
import { useEffect, useState } from "react";
import { useTranslation } from "react-i18next";

export function EditorAccessNotice({ projectId }: { projectId: string }) {
  const { t } = useTranslation();
  const [access, setAccess] = useState<EditorAccessDto | null>(null);
  const [failed, setFailed] = useState(false);
  const [revision, setRevision] = useState(0);
  // biome-ignore lint/correctness/useExhaustiveDependencies: revision retries the live inventory request.
  useEffect(() => {
    let live = true;
    const refresh = () => void getEditorAccess(projectId).then((value) => {
      if (live) { setAccess(value); setFailed(false); }
    }).catch(() => { if (live) setFailed(true); });
    refresh();
    const interval = window.setInterval(refresh, 15000);
    window.addEventListener("artisan:editor-access-refresh", refresh);
    return () => { live = false; window.clearInterval(interval); window.removeEventListener("artisan:editor-access-refresh", refresh); };
  }, [projectId, revision]);
  if (!access && !failed) return null;
  const unknown = failed || !access?.inventoryAvailable;
  const module = access?.projectOrigin === "module";
  const pro = !!access?.proUntil;
  const locked = !module && access?.enabled && access.reason === "free_quota_exceeded";
  const message = unknown ? t("editorAccess.unavailable")
    : module ? t("editorAccess.module")
    : locked ? t(pro ? "editorAccess.proLocked" : "editorAccess.locked", { count: access.count, quota: access.quota })
    : access?.reason === "free_quota_reached" ? t(pro ? "editorAccess.proAtQuota" : "editorAccess.atQuota", { quota: access.quota })
    : pro ? t("editorAccess.pro", { count: access.count, quota: access.quota })
    : t("editorAccess.count", { count: access?.count, quota: access?.quota });
  return <div role={locked || unknown ? "alert" : "status"} className="flex shrink-0 flex-wrap items-center gap-3 border-b border-[var(--border-soft)] bg-[var(--surface-raised)] px-5 py-2 text-sm text-[var(--text)]">
    <span>{message}</span>
    {!pro && (locked || access?.reason === "free_quota_reached") && <a href="/pricing" className="text-[var(--brand)] underline underline-offset-2">{t("editorAccess.proLink")}</a>}
    {unknown && <Button variant="outline" size="sm" onClick={() => setRevision((value) => value + 1)}>{t("editorAccess.retry")}</Button>}
  </div>;
}
