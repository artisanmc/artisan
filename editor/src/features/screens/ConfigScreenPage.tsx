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
import { cx } from "@/lib/cx";
import { YamlFileEditor, yamlErrorsOf } from "./YamlFileEditor";
import { fetchServerDeclaredModels } from "@/lib/api/dataSources";
import { useAccountStore } from "@/state/accountStore";
import { useServerScreensStore } from "@/state/serverScreensStore";
import { useCallback, useEffect, useMemo, useState } from "react";
import { useTranslation } from "react-i18next";
import { resolveScreen } from "./screenList";
import {
  besideModelPath,
  buildScratchProject,
  diffScratchForWrite,
  screenScratchId,
} from "./screenScratch";

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
  // Two modes over the SAME file (ADR yaml-assisted-editing ⑦). `draft` holds
  // the text being typed; it is null while the form is the surface being used.
  const [mode, setMode] = useState<"form" | "yaml">("form");
  const [draft, setDraft] = useState<ConfigFile[] | null>(null);
  const [selectedFile, setSelectedFile] = useState("");
  const [declaredModels, setDeclaredModels] = useState<Record<string, unknown>[]>([]);
  // What the writer would emit for the freshly-loaded file, before anyone
  // touched anything. A legacy file re-canonicalizes on the way out, and that
  // rewrite must not be mistaken for an edit: opening a screen changes nothing.
  const [baselineEmit, setBaselineEmit] = useState<Map<string, string>>(new Map());

  const load = useCallback(async () => {
    if (!screen) return;
    setPhase("loading");
    // A project-authored source keeps its schema in `models/<id>.yaml` beside
    // the data file — read it too, or the form opens untyped. Absent (a
    // module-declared table types itself from the declaration) is not an error.
    const [models, res, beside] = await Promise.all([
      fetchServerDeclaredModels(networkId, serverId),
      configRead(networkId, serverId, { projectId: screen.projectId, table: screen.table }),
      configRead(networkId, serverId, {
        projectId: screen.projectId,
        table: besideModelPath(screen.table),
      }),
    ]);
    if (!res.ok) {
      setErrorCode(res.error);
      setPhase(res.error === "server_offline" ? "offline" : "error");
      return;
    }
    const files = [...res.files, ...(beside.ok ? beside.files : [])];
    const pack = buildScratchProject(screen, files, models);
    useAccountStore.getState().upsertScratchProject(pack);
    setDeclaredModels(models);
    setBaselineEmit(
      new Map(diffScratchForWrite(pack, screen, files).files.map((f) => [f.path, f.content])),
    );
    setOriginal(files);
    setDraft(null);
    setMode("form");
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

  // Text mode owns the truth while it is being typed; the form's serialization
  // takes over as soon as the text is valid and adopted back into the scratch.
  const yamlErrors = useMemo(() => (draft ? yamlErrorsOf(draft) : []), [draft]);

  const diff = useMemo(() => {
    if (!screen || phase !== "ready") return null;
    if (draft) {
      // Canonicalisation immédiate: the typed text is parsed into the domain
      // and re-emitted by the writer — unless it does not parse, in which case
      // the text itself is what we save (it is the admin's file).
      if (yamlErrors.length > 0) {
        const changed = draft.filter(
          (f) => original.find((o) => o.path === f.path)?.content !== f.content,
        );
        return { files: changed, deletes: [] };
      }
      const rebuilt = buildScratchProject(screen, draft, declaredModels);
      return diffScratchForWrite(rebuilt, screen, original);
    }
    if (!scratch) return null;
    return diffScratchForWrite(scratch, screen, original);
  }, [screen, scratch, original, phase, draft, yamlErrors, declaredModels]);
  /** Emissions that differ from the load-time ones — i.e. what the admin changed. */
  const editedFiles = useMemo(
    () => (diff?.files ?? []).filter((f) => baselineEmit.get(f.path) !== f.content),
    [diff, baselineEmit],
  );
  const dirty = editedFiles.length > 0 || (diff?.deletes.length ?? 0) > 0;

  /** The files as they stand right now: what is on disk, plus the admin's own
   *  unsaved edits — never a rewrite nobody asked for. */
  const currentFiles = useCallback((): ConfigFile[] => {
    const map = new Map(original.map((f) => [f.path, f.content]));
    if (!draft) {
      for (const f of editedFiles) map.set(f.path, f.content);
      for (const p of diff?.deletes ?? []) map.delete(p);
    }
    return [...map].map(([path, content]) => ({ path, content }));
  }, [original, draft, diff, editedFiles]);

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
            <div className="flex gap-1">
              <button
                type="button"
                // Invalid YAML can't produce a form — the text tab keeps it fixable
                // (ADR yaml-assisted-editing ⑦).
                disabled={yamlErrors.length > 0}
                onClick={() => {
                  if (draft && yamlErrors.length === 0 && screen) {
                    const rebuilt = buildScratchProject(screen, draft, declaredModels);
                    useAccountStore.getState().upsertScratchProject(rebuilt);
                    setDraft(null);
                  }
                  setMode("form");
                }}
                className={cx("chip h-7 px-3 text-[11px]", mode === "form" && "is-active")}
              >
                {t("screens.modeForm")}
              </button>
              <button
                type="button"
                onClick={() => {
                  if (!draft) setDraft(currentFiles());
                  setMode("yaml");
                }}
                className={cx("chip h-7 px-3 text-[11px]", mode === "yaml" && "is-active")}
              >
                {t("screens.modeYaml")}
              </button>
            </div>
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

      {phase === "ready" && mode === "yaml" && (
        <YamlFileEditor
          files={draft ?? currentFiles()}
          errors={yamlErrors}
          selected={selectedFile || (draft ?? currentFiles())[0]?.path || ""}
          onSelect={setSelectedFile}
          onChange={(path, content) =>
            setDraft((prev) =>
              (prev ?? currentFiles()).map((f) => (f.path === path ? { ...f, content } : f)),
            )
          }
        />
      )}

      {phase === "ready" && mode === "form" && scratch && (
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
