import { ChangeList, type ChangeSet } from "@/components/ui/change-list";
import { Checkbox } from "@/components/ui/checkbox";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Spinner } from "@/components/ui/spinner";
import type { DocumentChecks } from "@/features/project/publish/publishFlow";
import type { OtherDrafts } from "@/features/project/publish/useOtherDrafts";
import { ServerChecksSection } from "@/features/serverIndex/ServerChecksSection";
import type { ServerChecks } from "@/features/serverIndex/serverChecks";
import { type ReactNode, useId, useMemo } from "react";
import { useTranslation } from "react-i18next";

/** Last look at what a deployment writes to the server disk, before anything is sent. */
export function DeployReviewDialog({
  changes,
  checks,
  documents,
  current,
  others,
  onToggleOther,
  onConfirm,
  onCancel,
}: {
  changes: ChangeSet | null;
  /** What this deployment could break in the server's other projects. */
  checks?: ServerChecks;
  /** Whether the changed files would load on the server: problems block the deployment. */
  documents?: DocumentChecks;
  /** The open Project's working copy: whether it has changes and goes out. Absent: it always does. */
  current?: { dirty: boolean; picked: boolean; toggle: () => void };
  /** The player's drafts of other Projects, each deployed with this one when picked. */
  others?: OtherDrafts | null;
  onToggleOther?: (draftId: string) => void;
  onConfirm: () => void;
  onCancel: () => void;
}) {
  const { t } = useTranslation();
  const problems = useMemo(() => byPath(documents), [documents]);
  const othersReady = others?.status === "ready" ? others : null;
  const listed = (othersReady?.drafts.length ?? 0) > 0;
  const currentGoes = current ? current.picked : true;
  const pickedOthers = othersReady
    ? othersReady.drafts.filter((d) => othersReady.selected.includes(d.draftId))
    : [];
  const blocked =
    (currentGoes && documents?.status === "ready" && documents.problems.length > 0) ||
    pickedOthers.some((d) => {
      const check = othersReady?.checks[d.draftId];
      return check?.status === "ready" && check.problems.length > 0;
    });
  const count = (currentGoes ? 1 : 0) + pickedOthers.length;
  return (
    <Dialog open={changes !== null} onOpenChange={(open) => !open && onCancel()}>
      <DialogContent className="flex max-h-[90dvh] w-[calc(100%-2rem)] max-w-6xl flex-col">
        <DialogHeader className="pr-6">
          <DialogTitle>{t("deploy.reviewTitle")}</DialogTitle>
          <DialogDescription>{t("deploy.reviewBody")}</DialogDescription>
        </DialogHeader>
        <div className="flex min-h-0 flex-1 flex-col gap-3 overflow-y-auto">
          {listed && current && (
            <PickRow
              checked={current.picked}
              disabled={!current.dirty}
              onChange={current.toggle}
              label={t("deploy.others.current")}
              detail={current.dirty ? undefined : t("deploy.others.currentNone")}
            />
          )}
          {(!current || current.dirty) && (
            <>
              {documents && <DocumentChecksSection documents={documents} changes={changes} />}
              {checks && <ServerChecksSection checks={checks} />}
              {changes && (
                <ChangeList
                  {...changes}
                  problems={problems}
                  beforeLabel={t("deploy.server")}
                  afterLabel={t("deploy.draft")}
                />
              )}
            </>
          )}
          {others && onToggleOther && (
            <OtherDraftsSection others={others} onToggle={onToggleOther} />
          )}
        </div>
        <DialogFooter>
          <button type="button" className="btn btn-sm btn-ghost" onClick={onCancel}>
            {t("save.cancel")}
          </button>
          <button
            type="button"
            className="btn btn-sm btn-primary"
            onClick={onConfirm}
            disabled={blocked || count === 0}
            title={blocked ? t("deploy.documents.blocked") : undefined}
          >
            {count > 1 ? t("deploy.others.confirm", { count }) : t("deploy.confirm")}
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

/** The server's problems of a check, by file, as the change list shows them. */
function byPath(documents: DocumentChecks | undefined): Record<string, string[]> {
  const out: Record<string, string[]> = {};
  if (documents?.status === "ready")
    for (const p of documents.problems)
      out[p.path] = [...(out[p.path] ?? []), `${p.stage}: ${p.message}`];
  return out;
}

function PickRow({
  checked,
  disabled,
  onChange,
  label,
  detail,
  badge,
}: {
  checked: boolean;
  disabled?: boolean;
  onChange: () => void;
  label: ReactNode;
  detail?: ReactNode;
  badge?: ReactNode;
}) {
  const id = useId();
  return (
    <div className="flex items-center gap-2 text-[13px] text-[var(--text)]">
      <Checkbox id={id} checked={checked} disabled={disabled} onCheckedChange={onChange} />
      <label htmlFor={id} className="min-w-0 flex-1 cursor-pointer truncate font-semibold">
        {label}
      </label>
      {badge}
      {detail && <span className="shrink-0 text-[12px] text-[var(--text-faint)]">{detail}</span>}
    </div>
  );
}

/**
 * The player's drafts of other Projects (and this Project's other drafts), one row each. A picked
 * one shows its diff and the server's check; one per Project can be picked.
 */
function OtherDraftsSection({
  others,
  onToggle,
}: {
  others: OtherDrafts;
  onToggle: (draftId: string) => void;
}) {
  const { t } = useTranslation();
  return (
    <section aria-label={t("deploy.others.title")} className="flex flex-col gap-2">
      <h3 className="eyebrow text-[var(--text-mut)]">{t("deploy.others.title")}</h3>
      {others.status === "loading" ? (
        <p className="flex items-center gap-2 text-[12.5px] text-[var(--text-mut)]">
          <Spinner className="size-3.5" />
          {t("deploy.others.loading")}
        </p>
      ) : others.status === "failed" ? (
        <p className="text-[12.5px] text-[var(--text-mut)]">
          {t("deploy.others.failedToLoad", { code: others.code })}
        </p>
      ) : others.drafts.length === 0 ? (
        <p className="text-[12.5px] text-[var(--text-mut)]">{t("deploy.others.none")}</p>
      ) : (
        others.drafts.map((draft) => {
          const picked = others.selected.includes(draft.draftId);
          const check = others.checks[draft.draftId];
          const problems = check?.status === "ready" ? check.problems : [];
          return (
            <div key={draft.draftId} className="card flex flex-col gap-2 p-3">
              <PickRow
                checked={picked}
                disabled={draft.unsynced}
                onChange={() => onToggle(draft.draftId)}
                label={
                  <>
                    {draft.projectName}
                    <span className="font-normal text-[var(--text-mut)]">
                      {" · "}
                      {draft.draftName}
                      {draft.serverLabel ? ` · ${draft.serverLabel}` : ""}
                    </span>
                  </>
                }
                badge={
                  problems.length > 0 ? (
                    <span className="badge badge-brick">{problems.length}</span>
                  ) : check?.status === "ready" ? (
                    <span className="badge badge-sage">✓</span>
                  ) : check?.status === "pending" ? (
                    <Spinner className="size-3.5" />
                  ) : null
                }
                detail={draft.unsynced ? t("deploy.others.unsynced") : undefined}
              />
              {picked && check && check.status !== "ready" && (
                <p className="text-[12px] text-[var(--text-mut)]">
                  {check.status === "pending"
                    ? t("deploy.documents.pending")
                    : t("deploy.documents.unavailable", { code: check.code })}
                </p>
              )}
              {picked && (
                <ChangeList
                  {...draft.changes}
                  problems={byPath(check)}
                  beforeLabel={t("deploy.server")}
                  afterLabel={t("deploy.draft")}
                />
              )}
            </div>
          );
        })
      )}
    </section>
  );
}
