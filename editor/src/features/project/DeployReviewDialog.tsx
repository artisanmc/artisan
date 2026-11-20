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
import type { DocumentImpact } from "@/lib/api/documentChecks";
import { type ReactNode, useId, useMemo, useState } from "react";
import { useTranslation } from "react-i18next";

/** Last look at what a deployment writes to the server disk, before anything is sent. */
export function DeployReviewDialog({
  changes,
  checks,
  documents,
  current,
  others,
  onToggleOther,
  othersOnly = false,
  onConfirm,
  onCancel,
}: {
  /** The open Project's changes; null: closed (unless [othersOnly]). */
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
  /**
   * No open Project (the server's Assistant tab): the review shows drafts only, open while
   * [others] is set.
   */
  othersOnly?: boolean;
  onConfirm: () => void;
  onCancel: () => void;
}) {
  const { t } = useTranslation();
  const problems = useMemo(() => byPath(documents), [documents]);
  const othersReady = others?.status === "ready" ? others : null;
  const listed = (othersReady?.drafts.length ?? 0) > 0;
  const currentGoes = othersOnly ? false : current ? current.picked : true;
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
  // What players lose in everything that goes out: confirmed as a whole, again when it changes.
  const losses = [
    ...(currentGoes ? impactsOf(documents) : []),
    ...pickedOthers.flatMap((d) => impactsOf(othersReady?.checks[d.draftId])),
  ].filter((impact) => impact.level === "loss");
  const lossKey = losses.map((impact) => `${impact.path}\n${impact.message}`).join("\n\n");
  const [confirmedLosses, setConfirmedLosses] = useState<string | null>(null);
  const unconfirmed = losses.length > 0 && confirmedLosses !== lossKey;
  const confirmId = useId();
  return (
    <Dialog
      open={othersOnly ? others != null : changes !== null}
      onOpenChange={(open) => !open && onCancel()}
    >
      <DialogContent className="flex max-h-[90dvh] w-[calc(100%-2rem)] max-w-6xl flex-col">
        <DialogHeader className="pr-6">
          <DialogTitle>{t("deploy.reviewTitle")}</DialogTitle>
          <DialogDescription>{t("deploy.reviewBody")}</DialogDescription>
        </DialogHeader>
        <div className="flex min-h-0 flex-1 flex-col gap-3 overflow-y-auto">
          {!othersOnly && listed && current && (
            <PickRow
              checked={current.picked}
              disabled={!current.dirty}
              onChange={current.toggle}
              label={t("deploy.others.current")}
              detail={current.dirty ? undefined : t("deploy.others.currentNone")}
            />
          )}
          {!othersOnly && (!current || current.dirty) && (
            <>
              {documents && <DocumentChecksSection documents={documents} changes={changes} />}
              <ImpactsSection impacts={impactsOf(documents)} />
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
        {losses.length > 0 && (
          <div className="flex items-start gap-2 text-[13px] text-[var(--text)]">
            <Checkbox
              id={confirmId}
              checked={!unconfirmed}
              onCheckedChange={(checked) => setConfirmedLosses(checked === true ? lossKey : null)}
            />
            <label htmlFor={confirmId} className="cursor-pointer">
              {t("deploy.impacts.confirm", { count: losses.length })}
            </label>
          </div>
        )}
        <DialogFooter>
          <button type="button" className="btn btn-sm btn-ghost" onClick={onCancel}>
            {t("save.cancel")}
          </button>
          <button
            type="button"
            className="btn btn-sm btn-primary"
            onClick={onConfirm}
            disabled={blocked || unconfirmed || count === 0}
            title={
              blocked
                ? t("deploy.documents.blocked")
                : unconfirmed
                  ? t("deploy.impacts.blocked")
                  : undefined
            }
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

function impactsOf(documents: DocumentChecks | undefined): DocumentImpact[] {
  return documents?.status === "ready" ? (documents.impacts ?? []) : [];
}

/**
 * What the changes do to the players already in the game, said by the module that owns each
 * file's kind: the losses first, each under its file. Nothing to say: nothing shown.
 */
function ImpactsSection({ impacts }: { impacts: DocumentImpact[] }) {
  const { t } = useTranslation();
  if (impacts.length === 0) return null;
  const rank = { loss: 0, unassessed: 1, notice: 2 } as const;
  const sorted = [...impacts].sort((a, b) => rank[a.level] - rank[b.level]);
  const losses = impacts.filter((impact) => impact.level === "loss").length;
  return (
    <section aria-label={t("deploy.impacts.title")} className="card mb-3 p-3">
      <div className="flex items-center gap-2">
        {losses > 0 && <span className="badge badge-brick">{losses}</span>}
        <h3 className="text-[13px] font-semibold text-[var(--text)]">
          {t("deploy.impacts.title")}
        </h3>
      </div>
      <p className="mt-2 text-[12.5px] text-[var(--text-mut)]">{t("deploy.impacts.body")}</p>
      <ul className="mt-2 space-y-1.5 text-[12.5px] text-[var(--text)]">
        {sorted.map((impact) => (
          <li key={`${impact.path}:${impact.level}:${impact.message}`} className="flex gap-2">
            <span
              className={`badge shrink-0 self-start ${impact.level === "loss" ? "badge-brick" : "badge-amber"}`}
            >
              {impact.level === "loss" ? t("deploy.impacts.loss") : t("deploy.impacts.notice")}
            </span>
            <span className="min-w-0">
              <span className="font-mono text-[var(--text-mut)]">{impact.path}</span>
              <br />
              {impact.level === "unassessed"
                ? t("deploy.impacts.unassessed", { detail: impact.message })
                : impact.message}
            </span>
          </li>
        ))}
      </ul>
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
              {picked && <ImpactsSection impacts={impactsOf(check)} />}
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
