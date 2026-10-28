import { ChangeList, type ChangeSet } from "@/components/ui/change-list";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import type { DocumentChecks } from "@/features/project/publish/publishFlow";
import { ServerChecksSection } from "@/features/serverIndex/ServerChecksSection";
import type { ServerChecks } from "@/features/serverIndex/serverChecks";
import { useMemo } from "react";
import { useTranslation } from "react-i18next";

/** Last look at what a deployment writes to the server disk, before anything is sent. */
export function DeployReviewDialog({
  changes,
  checks,
  documents,
  onConfirm,
  onCancel,
}: {
  changes: ChangeSet | null;
  /** What this deployment could break in the server's other projects. */
  checks?: ServerChecks;
  /** Whether the changed files would load on the server: problems block the deployment. */
  documents?: DocumentChecks;
  onConfirm: () => void;
  onCancel: () => void;
}) {
  const { t } = useTranslation();
  const problems = useMemo(() => {
    const byPath: Record<string, string[]> = {};
    if (documents?.status === "ready")
      for (const p of documents.problems) {
        byPath[p.path] = [...(byPath[p.path] ?? []), `${p.stage}: ${p.message}`];
      }
    return byPath;
  }, [documents]);
  const blocked = documents?.status === "ready" && documents.problems.length > 0;
  return (
    <Dialog open={changes !== null} onOpenChange={(open) => !open && onCancel()}>
      <DialogContent className="flex max-h-[90dvh] w-[calc(100%-2rem)] max-w-6xl flex-col">
        <DialogHeader className="pr-6">
          <DialogTitle>{t("deploy.reviewTitle")}</DialogTitle>
          <DialogDescription>{t("deploy.reviewBody")}</DialogDescription>
        </DialogHeader>
        {documents && <DocumentChecksSection documents={documents} changes={changes} />}
        {checks && <ServerChecksSection checks={checks} />}
        {changes && (
          <ChangeList
            {...changes}
            problems={problems}
            beforeLabel={t("deploy.server")}
            afterLabel={t("deploy.draft")}
            className="min-h-0 flex-1 overflow-y-auto"
          />
        )}
        <DialogFooter>
          <button type="button" className="btn btn-sm btn-ghost" onClick={onCancel}>
            {t("save.cancel")}
          </button>
          <button
            type="button"
            className="btn btn-sm btn-primary"
            onClick={onConfirm}
            disabled={blocked}
            title={blocked ? t("deploy.documents.blocked") : undefined}
          >
            {t("deploy.confirm")}
          </button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

/**
 * The server's verdict on the changed files: the check Deploy runs before writing. A problem
 * outside the change list (a file the check names that the diff does not show) is listed here.
 */
function DocumentChecksSection({
  documents,
  changes,
}: {
  documents: DocumentChecks;
  changes: ChangeSet | null;
}) {
  const { t } = useTranslation();
  const problems = documents.status === "ready" ? documents.problems : [];
  const shown = new Set([
    ...Object.keys(changes?.before ?? {}),
    ...Object.keys(changes?.after ?? {}),
  ]);
  const elsewhere = problems.filter((p) => !shown.has(p.path));
  return (
    <section aria-label={t("deploy.documents.title")} className="card mb-3 p-3">
      <div className="flex items-center gap-2">
        {problems.length > 0 ? (
          <span className="badge badge-brick">{problems.length}</span>
        ) : documents.status === "ready" ? (
          <span className="badge badge-sage">✓</span>
        ) : null}
        <h3 className="text-[13px] font-semibold text-[var(--text)]">
          {t("deploy.documents.title")}
        </h3>
      </div>
      <p className="mt-2 text-[12.5px] text-[var(--text-mut)]">
        {documents.status === "pending"
          ? t("deploy.documents.pending")
          : documents.status === "unavailable"
            ? t("deploy.documents.unavailable", { code: documents.code })
            : problems.length > 0
              ? t("deploy.documents.problems", { count: problems.length })
              : t("deploy.documents.none")}
      </p>
      {elsewhere.length > 0 && (
        <ul className="mt-2 space-y-1 text-[12.5px] text-[var(--text)]">
          {elsewhere.map((p) => (
            <li key={`${p.path}:${p.stage}:${p.message}`}>
              <span className="font-mono">{p.path}</span> — {p.stage}: {p.message}
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}
