import { Button } from "@/components/ui/button";
import type { Asset } from "@/domain/asset";
import type { ProjectId } from "@/domain/types";
import { assetDiskPath } from "@/lib/pack/assetDiskWrite";
import { useProjectBaselineStore } from "@/state/projectBaselineStore";
import { useProjectRuntime } from "@/state/projectRuntimeStore";
import { originalChanged, useProjectTemplatesStore } from "@/state/projectTemplatesStore";
import { useProjectsStore } from "@/state/projectsStore";
import { useEffect, useMemo, useState } from "react";
import { useTranslation } from "react-i18next";

/**
 * Says that the original of the image changed since the owner's version of it, and lets them
 * keep theirs (ADR `common-images-and-themes`, decision 8). Their version stays the one shown
 * either way; restoring the original is the panel's own button. Nothing while the original is
 * the one their version was made against, or on a server that records no origins.
 */
export function OriginalChanged({ projectId, asset }: { projectId: ProjectId; asset: Asset }) {
  const { t } = useTranslation();
  const project = useProjectsStore((s) => s.openProjects.projects.find((p) => p.id === projectId));
  const serverId = useProjectRuntime(projectId)?.serverId ?? project?.serverKeyId ?? null;
  const diskId = project ? (project.diskId ?? project.id) : null;
  const target = useMemo(
    () => (serverId && diskId ? { serverId, diskId } : null),
    [serverId, diskId],
  );
  const entry = useProjectTemplatesStore((s) => s.entries[projectId]);
  const baseline = useProjectBaselineStore((s) => s.baselines[projectId]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // The module's tree reads the origins when it is shown; here when it has not.
  const unread = !entry;
  useEffect(() => {
    if (!target || !baseline || !unread) return;
    void useProjectTemplatesStore.getState().load(projectId, target, baseline);
  }, [projectId, target, baseline, unread]);

  const path = assetDiskPath(asset.type, asset.id);
  if (asset.type === "font" || !entry || !originalChanged(entry.origins, path)) return null;

  const onKeep = async () => {
    if (!target) return;
    setBusy(true);
    setError(null);
    const failure = await useProjectTemplatesStore.getState().keep(projectId, target, path);
    setBusy(false);
    if (failure) {
      setError(
        t(`resources.originalChanged.errors.${failure}`, {
          defaultValue: t(
            `moduleTemplates.errors.${failure}`,
            t("moduleTemplates.errors.fetch_error"),
          ),
        }),
      );
    }
  };

  return (
    <div
      className="flex flex-col gap-2 rounded-[var(--r-md)] border border-[var(--warning)] bg-[var(--warning-soft)] p-2 text-xs"
      data-testid="original-changed"
    >
      <p className="font-medium">{t("resources.originalChanged.title")}</p>
      <p className="text-[var(--text-mut)]">{t("resources.originalChanged.hint")}</p>
      <Button size="sm" disabled={busy || !target} onClick={onKeep}>
        {t("resources.originalChanged.keep")}
      </Button>
      {error && (
        <p role="alert" className="text-[var(--danger)]">
          {error}
        </p>
      )}
    </div>
  );
}
