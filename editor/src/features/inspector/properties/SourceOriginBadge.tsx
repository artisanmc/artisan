import { Badge } from "@/components/ui/badge";
import type { Project } from "@/domain/types";
import { resolveSourceRefWithOrigin } from "@/features/canvas/menuPreviewScope";
import { useServerDataSourcesStore } from "@/state/serverDataSourcesStore";
import { useServerSnapshotsStore } from "@/state/serverSnapshotsStore";
import { useTranslation } from "react-i18next";

/**
 * Where the rows a menu shows for a module source come from: the draft being
 * edited, or the server. A source the plugin declares `content` or `mixed` that
 * still shows the server's rows (its module computes nothing from the draft) is
 * flagged: edits to its files are not visible until they are published.
 * Nothing for a Project source (`pack:`), always the draft.
 */
export function SourceOriginBadge({ project, sourceRef }: { project: Project; sourceRef: string }) {
  const { t } = useTranslation();
  const snapshots = useServerSnapshotsStore((s) => s.rowsByRef);
  const declared = useServerDataSourcesStore(
    (s) => s.sources.find((x) => x.ref === sourceRef)?.origin ?? null,
  );
  if (sourceRef.startsWith("pack:")) return null;
  const { origin } = resolveSourceRefWithOrigin(sourceRef, project, snapshots);
  if (origin === "none") return null;
  if (origin === "draft") {
    return (
      <Badge
        variant="sage"
        data-testid="source-origin-draft"
        title={t("dataSources.originDraftHint")}
      >
        {t("dataSources.originDraft")}
      </Badge>
    );
  }
  if (declared === "content" || declared === "mixed") {
    return (
      <Badge
        variant="amber"
        data-testid="source-origin-stale"
        title={t("dataSources.originDeployedHint")}
      >
        {t("dataSources.originDeployed")}
      </Badge>
    );
  }
  return (
    <Badge variant="terra" data-testid="source-origin-live" title={t("dataSources.originLiveHint")}>
      {t("dataSources.originLive")}
    </Badge>
  );
}
