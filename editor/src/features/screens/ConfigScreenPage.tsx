import { Button } from "@/components/ui/button";
import { EmptyState } from "@/components/ui/empty-state";
import { ConfigValueForm, SourceRowsTable } from "@/features/data/SourceValueEditor";
import {
  type ConfigErrorCode,
  type ConfigFile,
  configRead,
  configWrite,
} from "@/lib/api/configScreens";
import { useTextureInit } from "@/features/canvas/useTextureInit";
import { fetchServerDeclaredModels } from "@/lib/api/dataSources";
import { useAccountStore } from "@/state/accountStore";
import { useServerScreensStore } from "@/state/serverScreensStore";
import { useCallback, useEffect, useMemo, useState } from "react";
import { useTranslation } from "react-i18next";
import { resolveScreen } from "./screenList";
import { buildScratchProject, diffScratchForWrite, screenScratchId } from "./screenScratch";

type Phase = "loading" | "offline" | "error" | "ready";

/**
 * Generic module Config screen (ADR module-config-screens): reads the table's
 * files live from the server over the WS relay, edits a scratch working copy
 * in the account store (reusing the core form generator), writes back over the
 * same relay. Greyed out while the server is offline — the disk is the truth.
 */
export function ConfigScreenPage({
  networkId,
  serverId,
  screenId,
}: {
  networkId: string;
  serverId: string;
  screenId: string;
}) {
  const { t } = useTranslation();
  const declared = useServerScreensStore((s) => s.screens);
  const localProjects = useAccountStore((s) => s.account.projects);
  const removeProject = useAccountStore((s) => s.removeProject);

  const screen = useMemo(
    () => resolveScreen(screenId, declared, localProjects),
    [screenId, declared, localProjects],
  );
  const scratchId = screen ? screenScratchId(screen.id) : null;
  const scratch = useAccountStore((s) =>
    scratchId ? s.account.projects.find((p) => p.id === scratchId) : undefined,
  );

  // The screen edits a module-owned project without opening its canvas — load
  // its item library so the `item` field pickers resolve (they read the
  // texture store, which only EditorPane used to fill).
  useTextureInit(screen?.projectId);

  const [phase, setPhase] = useState<Phase>("loading");
  const [errorCode, setErrorCode] = useState<ConfigErrorCode | null>(null);
  const [original, setOriginal] = useState<ConfigFile[]>([]);
  const [saving, setSaving] = useState(false);

  const load = useCallback(async () => {
    if (!screen) return;
    setPhase("loading");
    const [models, res] = await Promise.all([
      fetchServerDeclaredModels(networkId, serverId),
      configRead(networkId, serverId, { projectId: screen.projectId, table: screen.table }),
    ]);
    if (!res.ok) {
      setErrorCode(res.error);
      setPhase(res.error === "server_offline" ? "offline" : "error");
      return;
    }
    const pack = buildScratchProject(screen, res.files, models);
    useAccountStore.getState().upsertScratchProject(pack);
    setOriginal(res.files);
    setPhase("ready");
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [networkId, serverId, screen?.id, screen?.projectId, screen?.table]);

  useEffect(() => {
    void load();
  }, [load]);

  // The scratch is transient: drop it when leaving the screen so nothing else
  // (sidebar counts, exports, pickers) ever sees it.
  useEffect(() => {
    if (!scratchId) return;
    return () => removeProject(scratchId);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [scratchId]);

  const diff = useMemo(() => {
    if (!screen || !scratch || phase !== "ready") return null;
    return diffScratchForWrite(scratch, screen, original);
  }, [screen, scratch, original, phase]);
  const dirty = (diff?.files.length ?? 0) > 0 || (diff?.deletes.length ?? 0) > 0;

  const save = useCallback(async () => {
    if (!screen || !scratch || !diff || !dirty) return;
    setSaving(true);
    try {
      const res = await configWrite(networkId, serverId, {
        projectId: screen.projectId,
        files: diff.files,
        deletes: diff.deletes,
      });
      if (!res.ok) {
        setErrorCode(res.error);
        setPhase(res.error === "server_offline" ? "offline" : "error");
        return;
      }
      // The written set becomes the new baseline.
      const next = new Map(original.map((f) => [f.path, f.content]));
      for (const f of diff.files) next.set(f.path, f.content);
      for (const p of diff.deletes) next.delete(p);
      setOriginal([...next].map(([path, content]) => ({ path, content })));
    } finally {
      setSaving(false);
    }
  }, [networkId, serverId, screen, scratch, diff, dirty, original]);

  if (!screen) {
    return (
      <div className="card flex min-h-0 flex-1 items-center justify-center p-6">
        <EmptyState title={t("screens.notFound")} />
      </div>
    );
  }

  const source = scratch?.dataSources.find(
    (d) => (d.id as string) === screen.table.split("/").pop(),
  );

  return (
    <main className="card flex min-h-0 flex-1 flex-col overflow-auto p-6 md:p-8" data-testid="config-screen">
      <div className="mb-4 flex items-center gap-3">
        <div className="min-w-0 flex-1">
          <div className="eyebrow">{screen.moduleId ?? t("screens.moduleFallback")}</div>
          <h1 className="truncate text-lg font-semibold">{screen.label}</h1>
        </div>
        {phase === "ready" && (
          <>
            <Button variant="ghost" size="sm" onClick={() => void load()} disabled={saving}>
              {t("screens.reload")}
            </Button>
            <Button size="sm" onClick={() => void save()} disabled={!dirty || saving}>
              {saving ? t("screens.saving") : dirty ? t("screens.save") : t("screens.saved")}
            </Button>
          </>
        )}
      </div>

      {phase === "loading" && (
        <div className="mt-8 text-center text-sm text-[var(--text-faint)]">{t("screens.loading")}</div>
      )}

      {phase === "offline" && (
        <EmptyState
          title={t("screens.offline")}
          hint={t("screens.offlineHint")}
          action={<Button onClick={() => void load()}>{t("screens.retry")}</Button>}
        />
      )}

      {phase === "error" && (
        <EmptyState
          title={t("screens.error")}
          hint={errorCode ?? undefined}
          action={<Button onClick={() => void load()}>{t("screens.retry")}</Button>}
        />
      )}

      {phase === "ready" && scratch && (
        source ? (
          source.shape === "table" ? (
            <SourceRowsTable projectId={scratch.id} pack={scratch} source={source} />
          ) : (
            <ConfigValueForm projectId={scratch.id} pack={scratch} source={source} />
          )
        ) : (
          <EmptyState title={t("screens.emptyTable")} hint={screen.table} />
        )
      )}
    </main>
  );
}
