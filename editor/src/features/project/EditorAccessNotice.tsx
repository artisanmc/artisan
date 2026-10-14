import { Button } from "@/components/ui/button";
import {
  type EditorAccessDto,
  getEditorAccess,
  getServerEditorAccess,
} from "@/lib/api/projectFiles";
import { useEffect, useState } from "react";
import { useTranslation } from "react-i18next";

type AccessScope =
  | { projectId: string; serverId?: never }
  | { projectId?: never; serverId: string };

export function EditorAccessNotice({ projectId, serverId }: AccessScope) {
  const { t } = useTranslation();
  const [access, setAccess] = useState<EditorAccessDto | null>(null);
  const [failed, setFailed] = useState(false);
  const [revision, setRevision] = useState(0);
  // biome-ignore lint/correctness/useExhaustiveDependencies: revision retries the live inventory request.
  useEffect(() => {
    let live = true;
    const refresh = () =>
      void (
        projectId !== undefined
          ? getEditorAccess(projectId)
          : getServerEditorAccess(serverId).then((value) => ({
              ...value,
              projectOrigin: "personal" as const,
            }))
      )
        .then((value) => {
          if (live) {
            setAccess(value);
            setFailed(false);
          }
        })
        .catch(() => {
          if (live) setFailed(true);
        });
    refresh();
    const interval = window.setInterval(refresh, 15000);
    window.addEventListener("artisan:editor-access-refresh", refresh);
    return () => {
      live = false;
      window.clearInterval(interval);
      window.removeEventListener("artisan:editor-access-refresh", refresh);
    };
  }, [projectId, serverId, revision]);
  if (!access && !failed) return null;
  const unknown = failed || !access?.inventoryAvailable;
  const module = access?.projectOrigin === "module";
  const locked = !module && access?.enabled && access.reason === "free_quota_exceeded";
  const message = unknown
    ? t("editorAccess.unavailable")
    : module
      ? t("editorAccess.module")
      : locked
        ? t("billing.catalog.resourceLocked", { count: access.count, quota: access.quota })
        : access?.reason === "free_quota_reached"
          ? t("billing.catalog.resourceAtQuota", { quota: access.quota })
          : access?.quota === null
            ? t("billing.catalog.resourceUnlimited", { count: access.count })
            : t("billing.catalog.resourceCount", { count: access?.count, quota: access?.quota });
  return (
    <div
      role={locked || unknown ? "alert" : "status"}
      className="flex flex-col items-start gap-2 px-2.5 py-2 text-sm text-[var(--text)]"
    >
      <span>{message}</span>
      {unknown && (
        <Button variant="outline" size="sm" onClick={() => setRevision((value) => value + 1)}>
          {t("editorAccess.retry")}
        </Button>
      )}
    </div>
  );
}
