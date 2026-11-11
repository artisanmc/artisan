import { useTranslation } from "react-i18next";
import type { IssueOwner, ServerChecks, ServerIssue } from "./serverChecks";

const ref = (o: IssueOwner) => `${o.namespace}:${o.docId}`;

/**
 * What this deployment could break **elsewhere** on the server. Warnings:
 * nothing here blocks. And an absence of results is never presented as a
 * green light when the checks could not run.
 */
export function ServerChecksSection({ checks }: { checks: ServerChecks }) {
  const { t } = useTranslation();
  if (checks.status === "none") return null;

  const note =
    checks.status === "pending"
      ? t("deploy.checks.pending")
      : checks.status === "unavailable"
        ? t("deploy.checks.unavailable")
        : null;
  const incomplete = checks.status === "ready" && checks.unreadable.length > 0;
  const clean = checks.status === "ready" && checks.issues.length === 0 && !incomplete;

  return (
    <section aria-label={t("deploy.checks.title")} className="card mb-3 p-3">
      <div className="flex items-center gap-2">
        {checks.issues.length > 0 ? (
          <span className="badge badge-amber">{checks.issues.length}</span>
        ) : clean ? (
          <span className="badge badge-sage">✓</span>
        ) : null}
        <h3 className="text-[13px] font-semibold text-[var(--text)]">{t("deploy.checks.title")}</h3>
      </div>
      {note && <p className="mt-2 text-[12.5px] text-[var(--text-mut)]">{note}</p>}
      {clean && (
        <p className="mt-2 text-[12.5px] text-[var(--text-mut)]">{t("deploy.checks.none")}</p>
      )}
      {incomplete && (
        <p className="mt-2 text-[12.5px] text-[var(--text-mut)]">
          {t("deploy.checks.unreadable", { names: checks.unreadable.join(", ") })}
        </p>
      )}
      {checks.issues.length > 0 && (
        <ul className="mt-2 space-y-1 text-[12.5px] text-[var(--text)]">
          {checks.issues.map((issue) => (
            <li key={issueKey(issue)}>{describe(issue, t)}</li>
          ))}
        </ul>
      )}
    </section>
  );
}

function issueKey(issue: ServerIssue): string {
  switch (issue.kind) {
    case "command_conflict":
      return `cmd:${issue.name}`;
    case "duplicate_id":
      return `dup:${issue.docKind}:${issue.id}`;
    case "broken_link":
      return `link:${issue.from.docKind}:${issue.from.docId}:${issue.targetId}`;
  }
}

function describe(issue: ServerIssue, t: (key: string, opts?: Record<string, unknown>) => string) {
  switch (issue.kind) {
    case "command_conflict":
      return t("deploy.checks.commandConflict", {
        name: issue.name,
        owners: issue.owners.map(ref).join(", "),
      });
    case "duplicate_id":
      return t(
        issue.docKind === "menu" ? "deploy.checks.duplicateMenu" : "deploy.checks.duplicateDialog",
        { id: issue.id, owners: issue.owners.map(ref).join(", ") },
      );
    case "broken_link":
      return t(
        issue.reason === "missing"
          ? "deploy.checks.brokenMissing"
          : "deploy.checks.brokenAmbiguous",
        {
          kind: t(`deploy.checks.kind.${issue.from.docKind}`),
          from: issue.from.docId,
          target: issue.targetId,
        },
      );
  }
}
