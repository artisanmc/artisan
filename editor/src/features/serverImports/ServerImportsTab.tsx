import { Badge } from "@/components/ui/badge";
import { Spinner } from "@/components/ui/spinner";
import { ApiError } from "@/lib/api/client";
import {
  type ImportListing,
  type ImportReport,
  type ImportRun,
  type ImportSource,
  listImports,
  startImport,
  startImportRollback,
} from "@/lib/api/imports";
import { useCallback, useEffect, useMemo, useState } from "react";
import { useTranslation } from "react-i18next";

/** How often the page asks again while a run it started, or anyone's, is in progress. */
const POLL_MS = 1500;
/** Rejected records listed per code before "and n more". */
const IDS_SHOWN = 5;
const NOTES_SHOWN = 20;

const totalOf = (report: ImportReport) => report.counts.reduce((sum, c) => sum + c.count, 0);

/** A dry run whose report allows the write: it read something new and nothing blocks. */
export function canImport(run: ImportRun | undefined): boolean {
  const report = run?.report;
  if (!run || !report || run.action !== "plan" || report.failed) return false;
  return report.blockers.length === 0 && totalOf(report) > 0;
}

/** Applied imports a later rollback undid, by batch. */
export function rolledBack(runs: ImportRun[]): Set<string> {
  return new Set(
    runs
      .filter((r) => r.action === "rollback" && r.applied && r.target)
      .map((r) => r.target as string),
  );
}

/**
 * The imports tab of a server (ADR `data-imports`): the sources its modules registered, a dry
 * run and its report before any write, then the history, where an import can be undone. The
 * runs happen on the server; this page starts them and reads their reports back.
 */
export function ServerImportsTab({ serverId }: { serverId: string }) {
  const { t, i18n } = useTranslation();
  const [listing, setListing] = useState<ImportListing | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  /** What each place of the page shows: `source:<id>` or `undo:<batch>` → the run's batch. */
  const [shown, setShown] = useState<Record<string, string>>({});
  const [files, setFiles] = useState<Record<string, string>>({});
  const [failure, setFailure] = useState<{ key: string; text: string } | null>(null);
  const [asking, setAsking] = useState<string | null>(null);

  const message = useCallback(
    (error: unknown) => {
      const api = ApiError.from(error);
      return t(`serverImports.errors.${api.code}`, {
        detail: api.detail ?? "",
        defaultValue: t("serverImports.errors.unknown"),
      });
    },
    [t],
  );

  const load = useCallback(async () => {
    try {
      setListing(await listImports(serverId));
      setLoadError(null);
    } catch (e) {
      setLoadError(message(e));
    }
  }, [serverId, message]);

  useEffect(() => {
    void load();
  }, [load]);

  const byBatch = useMemo(
    () => new Map((listing?.runs ?? []).map((run) => [run.batch, run])),
    [listing],
  );
  // A run this page started is waited for until the server has logged it.
  const waiting = Object.values(shown).some((batch) => !byBatch.has(batch));
  const active = (listing?.active.length ?? 0) > 0;
  useEffect(() => {
    if (!waiting && !active) return;
    const timer = setInterval(() => void load(), POLL_MS);
    return () => clearInterval(timer);
  }, [waiting, active, load]);

  const start = async (key: string, begin: () => Promise<string>) => {
    setAsking(key);
    setFailure(null);
    try {
      const batch = await begin();
      setShown((current) => ({ ...current, [key]: batch }));
      await load();
    } catch (e) {
      setFailure({ key, text: message(e) });
    } finally {
      setAsking(null);
    }
  };

  if (listing === null) {
    return loadError ? (
      <p className="text-[13px] text-[var(--danger)]">{loadError}</p>
    ) : (
      <p className="text-[13px] text-[var(--text-mut)]">{t("serverImports.loading")}</p>
    );
  }

  const lang = i18n.language;
  const undone = rolledBack(listing.runs);
  const labelOf = (id: string) => listing.sources.find((s) => s.id === id)?.label ?? id;
  const busyModule = (module: string) => listing.active.some((a) => a.module === module);
  const stateOf = (key: string) => {
    const batch = shown[key];
    const run = batch ? byBatch.get(batch) : undefined;
    return { run, pending: asking === key || (batch !== undefined && run === undefined) };
  };

  return (
    <div className="flex flex-col gap-6">
      <p className="text-[13px] text-[var(--text-mut)]">{t("serverImports.intro")}</p>
      {loadError && <p className="text-[12px] text-[var(--danger)]">{loadError}</p>}

      <section className="flex flex-col gap-2">
        <h2 className="eyebrow">{t("serverImports.sections.sources")}</h2>
        {listing.sources.length === 0 ? (
          <p className="text-[13px] text-[var(--text-mut)]">{t("serverImports.empty")}</p>
        ) : (
          listing.sources.map((source) => {
            const key = `source:${source.id}`;
            const { run, pending } = stateOf(key);
            const file = files[source.id] ?? "";
            return (
              <SourceCard
                key={source.id}
                source={source}
                files={listing.files}
                file={file}
                onFile={(next) => setFiles((current) => ({ ...current, [source.id]: next }))}
                run={run}
                pending={pending}
                busy={busyModule(source.module)}
                error={failure?.key === key ? failure.text : null}
                onDryRun={() =>
                  void start(key, () =>
                    startImport(serverId, source.id, {
                      file: file || undefined,
                      confirm: false,
                      lang,
                    }),
                  )
                }
                onImport={() => {
                  if (
                    !window.confirm(
                      t("serverImports.source.importConfirm", { label: source.label }),
                    )
                  )
                    return;
                  void start(key, () =>
                    startImport(serverId, source.id, {
                      file: file || undefined,
                      confirm: true,
                      lang,
                    }),
                  );
                }}
              />
            );
          })
        )}
      </section>

      <section className="flex flex-col gap-2">
        <h2 className="eyebrow">{t("serverImports.sections.history")}</h2>
        {listing.runs.length === 0 ? (
          <p className="text-[13px] text-[var(--text-mut)]">{t("serverImports.history.empty")}</p>
        ) : (
          listing.runs.map((run) => {
            const key = `undo:${run.batch}`;
            const undo = stateOf(key);
            return (
              <HistoryRow
                key={run.batch}
                run={run}
                label={labelOf(run.source)}
                lang={lang}
                undone={undone.has(run.batch)}
                undo={shown[key] !== undefined || asking === key ? undo : null}
                busy={busyModule(run.module)}
                error={failure?.key === key ? failure.text : null}
                onUndoDryRun={() =>
                  void start(key, () =>
                    startImportRollback(serverId, run.batch, { confirm: false, lang }),
                  )
                }
                onUndo={() => {
                  if (
                    !window.confirm(t("serverImports.history.undoConfirmAsk", { batch: run.batch }))
                  )
                    return;
                  void start(key, () =>
                    startImportRollback(serverId, run.batch, { confirm: true, lang }),
                  );
                }}
                onClose={() =>
                  setShown((current) => {
                    const { [key]: _closed, ...rest } = current;
                    return rest;
                  })
                }
              />
            );
          })
        )}
      </section>
    </div>
  );
}

function SourceCard({
  source,
  files,
  file,
  onFile,
  run,
  pending,
  busy,
  error,
  onDryRun,
  onImport,
}: {
  source: ImportSource;
  /** The files of the server's imports folder. */
  files: string[];
  file: string;
  onFile: (next: string) => void;
  /** The last run this page started for the source, once the server logged it. */
  run: ImportRun | undefined;
  /** That run is started and not logged yet. */
  pending: boolean;
  /** A run of the source's module is in progress, whoever started it. */
  busy: boolean;
  error: string | null;
  onDryRun: () => void;
  onImport: () => void;
}) {
  const { t } = useTranslation();
  const missingFile = source.readsFile && file === "";
  const blocked = pending || busy;
  return (
    <article className="card flex flex-col gap-3 p-4" data-testid={`source-${source.id}`}>
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="flex min-w-0 flex-col gap-1">
          <h3 className="text-[14px] font-semibold text-[var(--text)]">{source.label}</h3>
          <p className="text-[12px] text-[var(--text-faint)]">
            {t("serverImports.source.module", { module: source.module })}
            {" · "}
            <span className="font-mono">{source.id}</span>
          </p>
        </div>
        <div className="flex shrink-0 items-center gap-2">
          {blocked && (
            <span className="flex items-center gap-2 text-[12px] text-[var(--text-mut)]">
              <Spinner />
              {pending ? t("serverImports.source.running") : t("serverImports.source.busy")}
            </span>
          )}
          <button
            type="button"
            className="btn btn-sm"
            disabled={blocked || missingFile}
            onClick={onDryRun}
          >
            {run ? t("serverImports.source.dryRunAgain") : t("serverImports.source.dryRun")}
          </button>
          {canImport(run) && (
            <button
              type="button"
              className="btn btn-primary btn-sm"
              disabled={blocked || missingFile || source.conflictRunning !== null}
              onClick={onImport}
            >
              {t("serverImports.source.import")}
            </button>
          )}
        </div>
      </div>

      {source.readsFile &&
        (files.length === 0 ? (
          <p className="text-[12px] text-[var(--text-mut)]">{t("serverImports.source.noFile")}</p>
        ) : (
          <label className="flex flex-col gap-1">
            <span className="field-label">{t("serverImports.source.file")}</span>
            <select className="select" value={file} onChange={(e) => onFile(e.target.value)}>
              <option value="">{t("serverImports.source.pickFile")}</option>
              {files.map((name) => (
                <option key={name} value={name}>
                  {name}
                </option>
              ))}
            </select>
          </label>
        ))}
      {source.conflictRunning !== null && (
        <p className="text-[12px] text-[var(--warning)]">
          {t("serverImports.source.conflict", { plugin: source.conflictRunning })}
        </p>
      )}
      {error && <p className="text-[12px] text-[var(--danger)]">{error}</p>}
      {run && <ReportView run={run} />}
    </article>
  );
}

function HistoryRow({
  run,
  label,
  lang,
  undone,
  undo,
  busy,
  error,
  onUndoDryRun,
  onUndo,
  onClose,
}: {
  run: ImportRun;
  /** The source's label, or its id when the server no longer has it. */
  label: string;
  lang: string;
  /** A later rollback undid this import. */
  undone: boolean;
  /** The rollback asked from this row: its last run, or still on its way; null when none was asked. */
  undo: { run: ImportRun | undefined; pending: boolean } | null;
  busy: boolean;
  error: string | null;
  onUndoDryRun: () => void;
  onUndo: () => void;
  onClose: () => void;
}) {
  const { t } = useTranslation();
  const report = run.report;
  const dryRollback = run.action === "rollback" && report?.dryRun === true;
  const action = dryRollback
    ? t("serverImports.history.rollbackPlan")
    : t(`serverImports.history.${run.action}`);
  const when = useMemo(
    () => new Intl.DateTimeFormat(lang, { dateStyle: "medium", timeStyle: "short" }).format(run.at),
    [lang, run.at],
  );
  // An import that wrote nothing has nothing to undo; one that failed may have written.
  const wrote = report ? Boolean(report.failed) || totalOf(report) > 0 : true;
  const canUndo = run.action === "apply" && run.applied && !undone && wrote;
  // The dry run of the rollback found something to remove: the rollback itself is offered.
  const dry = undo?.run?.report;
  const undoReady = dry?.dryRun === true && !dry.failed && totalOf(dry) > 0;

  return (
    <article className="card flex flex-col gap-2 p-3" data-testid={`run-${run.batch}`}>
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="flex min-w-0 flex-wrap items-center gap-2">
          <span className="text-[13px] font-semibold text-[var(--text)]">{action}</span>
          <span className="text-[13px] text-[var(--text-mut)]">{label}</span>
          {report?.failed ? (
            <Badge variant="brick">{t("serverImports.history.failed")}</Badge>
          ) : report && report.blockers.length > 0 ? (
            <Badge variant="amber">{t("serverImports.history.blocked")}</Badge>
          ) : report && run.action !== "plan" && !report.dryRun && totalOf(report) === 0 ? (
            <Badge variant="terra">{t("serverImports.history.nothing")}</Badge>
          ) : (
            report && (
              <Badge variant={run.applied ? "sage" : "terra"}>
                {t("serverImports.history.total", { count: totalOf(report) })}
              </Badge>
            )
          )}
          {undone && <Badge variant="amber">{t("serverImports.history.rolledBack")}</Badge>}
        </div>
        {canUndo && undo === null && (
          <button
            type="button"
            className="btn btn-ghost btn-sm"
            disabled={busy}
            onClick={onUndoDryRun}
          >
            {t("serverImports.history.undo")}
          </button>
        )}
      </div>
      <p className="text-[12px] text-[var(--text-faint)]">
        {[
          when,
          t("serverImports.history.by", { actor: run.actor }),
          t("serverImports.history.batch", { batch: run.batch }),
          run.target ? t("serverImports.history.of", { batch: run.target }) : null,
        ]
          .filter(Boolean)
          .join(" · ")}
      </p>
      {report && (
        <details className="text-[13px]">
          <summary className="cursor-pointer text-[12px] text-[var(--text-mut)]">
            {t("serverImports.history.details")}
          </summary>
          <div className="mt-2">
            <ReportView run={run} />
          </div>
        </details>
      )}
      {error && <p className="text-[12px] text-[var(--danger)]">{error}</p>}
      {undo !== null && (
        <div className="flex flex-col gap-3 rounded-[var(--r-md)] border border-[var(--border)] p-3">
          {undo.pending || !undo.run ? (
            <span className="flex items-center gap-2 text-[12px] text-[var(--text-mut)]">
              <Spinner />
              {t("serverImports.source.running")}
            </span>
          ) : (
            <ReportView run={undo.run} />
          )}
          <div className="flex flex-wrap items-center gap-2">
            {undoReady && (
              <button
                type="button"
                className="btn btn-primary btn-sm"
                disabled={busy || undo.pending}
                onClick={onUndo}
              >
                {t("serverImports.history.undoConfirm")}
              </button>
            )}
            <button type="button" className="btn btn-ghost btn-sm" onClick={onClose}>
              {t("serverImports.history.undoCancel")}
            </button>
          </div>
        </div>
      )}
    </article>
  );
}

/** A run's report: what it says first, its counts, then what was left aside and why. */
export function ReportView({ run }: { run: ImportRun }) {
  const { t } = useTranslation();
  const report = run.report;
  if (!report) return null;
  if (report.failed) {
    return (
      <div className="flex flex-col gap-1" data-testid="import-report">
        <p className="text-[13px] text-[var(--danger)]">
          {t("serverImports.report.failed", { error: report.failed })}
        </p>
        {run.action === "apply" && (
          <p className="text-[12px] text-[var(--text-mut)]">
            {t("serverImports.report.failedApply")}
          </p>
        )}
      </div>
    );
  }
  const total = totalOf(report);
  const rollback = run.action === "rollback";
  const headline =
    report.blockers.length > 0
      ? t("serverImports.report.blocked")
      : rollback
        ? report.dryRun
          ? t("serverImports.report.rollbackDry")
          : total === 0
            ? t("serverImports.report.rollbackNothing")
            : t("serverImports.report.rollbackDone")
        : report.dryRun
          ? t("serverImports.report.dryRun")
          : total === 0
            ? t("serverImports.report.nothingNew")
            : t("serverImports.report.applied", { batch: run.batch });
  const byCode = new Map<string, typeof report.rejected>();
  for (const rejection of report.rejected) {
    byCode.set(rejection.code, [...(byCode.get(rejection.code) ?? []), rejection]);
  }

  return (
    <div className="flex flex-col gap-3" data-testid="import-report">
      <p
        className={
          report.blockers.length > 0
            ? "text-[13px] text-[var(--danger)]"
            : "text-[13px] text-[var(--text)]"
        }
      >
        {headline}
      </p>
      {report.blockers.length > 0 && (
        <div className="flex flex-col gap-1">
          <h4 className="field-label">{t("serverImports.report.blockers")}</h4>
          <ul className="list-disc pl-5 text-[13px] text-[var(--danger)]">
            {report.blockers.map((blocker) => (
              <li key={blocker}>{blocker}</li>
            ))}
          </ul>
        </div>
      )}
      {report.counts.length > 0 && (
        <dl className="grid grid-cols-[1fr_auto] gap-x-4 gap-y-1 text-[13px]">
          {report.counts.map((count) => (
            <div key={count.kind} className="contents">
              <dt className="text-[var(--text-mut)]">{count.label}</dt>
              <dd className="text-right font-mono text-[var(--text)]">{count.count}</dd>
            </div>
          ))}
        </dl>
      )}
      {report.alreadyImported > 0 && (
        <p className="text-[12px] text-[var(--text-mut)]">
          {t("serverImports.report.already", { count: report.alreadyImported })}
        </p>
      )}
      {report.rejected.length > 0 && (
        <details className="text-[13px]">
          <summary className="cursor-pointer text-[12px] text-[var(--text-mut)]">
            {t(rollback ? "serverImports.report.kept" : "serverImports.report.rejected", {
              count: report.rejected.length,
            })}
          </summary>
          <ul className="mt-2 flex flex-col gap-2">
            {[...byCode.entries()].map(([code, list]) => (
              <li key={code} className="flex flex-col gap-0.5">
                <span className="text-[12px] text-[var(--text)]">
                  <span className="font-mono">{code}</span> × {list.length}
                </span>
                <span className="text-[12px] text-[var(--text-mut)]">{list[0]?.message}</span>
                <span className="break-all font-mono text-[11px] text-[var(--text-faint)]">
                  {list
                    .slice(0, IDS_SHOWN)
                    .map((r) => r.sourceId)
                    .join(", ")}
                  {list.length > IDS_SHOWN &&
                    ` ${t("serverImports.report.rejectedMore", { count: list.length - IDS_SHOWN })}`}
                </span>
              </li>
            ))}
          </ul>
        </details>
      )}
      {report.notes.length > 0 && (
        <details className="text-[13px]">
          <summary className="cursor-pointer text-[12px] text-[var(--text-mut)]">
            {t("serverImports.report.notes")} ({report.notes.length})
          </summary>
          <ul className="mt-2 list-disc pl-5 text-[12px] text-[var(--text-mut)]">
            {report.notes.slice(0, NOTES_SHOWN).map((note) => (
              <li key={note}>{note}</li>
            ))}
            {report.notes.length > NOTES_SHOWN && (
              <li>
                {t("serverImports.report.rejectedMore", {
                  count: report.notes.length - NOTES_SHOWN,
                })}
              </li>
            )}
          </ul>
        </details>
      )}
    </div>
  );
}
