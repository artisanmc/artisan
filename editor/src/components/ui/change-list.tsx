import { cn } from "@/lib/cx";
import { ChevronRight } from "lucide-react";
import { useMemo, useState } from "react";
import { useTranslation } from "react-i18next";
import { FileDiff, diffStats } from "./file-diff";

type Binary = Record<string, { hash: string; size: number }>;

export type ChangeStatus = "added" | "deleted" | "modified" | "renamed";

export interface FileChange {
  path: string;
  /** Previous path of a renamed file. */
  from?: string;
  status: ChangeStatus;
  before: string | null;
  after: string | null;
  added: number;
  removed: number;
  binary?: boolean;
}

export interface ChangeSet {
  before: Record<string, string>;
  after: Record<string, string>;
  renames?: { from: string; to: string }[];
  binaryBefore?: Binary;
  binaryAfter?: Binary;
}

/** Every file that differs between two trees, renames paired, sorted by path. */
export function listChanges({
  before,
  after,
  renames = [],
  binaryBefore = {},
  binaryAfter = {},
}: ChangeSet): FileChange[] {
  const changes: FileChange[] = [];
  const paired = new Set<string>();
  for (const { from, to } of renames) {
    if (!(from in before) || !(to in after) || from in after || to in before) continue;
    paired.add(from).add(to);
    changes.push({
      path: to,
      from,
      status: "renamed",
      before: before[from]!,
      after: after[to]!,
      ...diffStats(before[from]!, after[to]!),
    });
  }
  for (const path of new Set([...Object.keys(before), ...Object.keys(after)])) {
    if (paired.has(path) || before[path] === after[path]) continue;
    const b = before[path] ?? null;
    const a = after[path] ?? null;
    changes.push({
      path,
      status: b === null ? "added" : a === null ? "deleted" : "modified",
      before: b,
      after: a,
      ...diffStats(b, a),
    });
  }
  for (const path of new Set([...Object.keys(binaryBefore), ...Object.keys(binaryAfter)])) {
    const b = binaryBefore[path];
    const a = binaryAfter[path];
    if (b?.hash === a?.hash && b?.size === a?.size) continue;
    changes.push({
      path,
      status: !b ? "added" : !a ? "deleted" : "modified",
      before: null,
      after: null,
      added: 0,
      removed: 0,
      binary: true,
    });
  }
  return changes.sort((x, y) => (x.path < y.path ? -1 : x.path > y.path ? 1 : 0));
}

const STATUS_BADGE: Record<ChangeStatus, string> = {
  added: "badge-sage",
  deleted: "badge-brick",
  modified: "badge-amber",
  renamed: "badge-terra",
};

export interface ChangeListProps extends ChangeSet {
  beforeLabel?: string;
  afterLabel?: string;
  /** Files opened on first render; defaults to all of them when there are few. */
  openLimit?: number;
  className?: string;
}

/** A git-style change set: a summary line, then one colored diff per changed file. */
export function ChangeList({
  beforeLabel,
  afterLabel,
  openLimit = 5,
  className,
  before,
  after,
  renames,
  binaryBefore,
  binaryAfter,
}: ChangeListProps) {
  const { t } = useTranslation();
  const changes = useMemo(
    () => listChanges({ before, after, renames, binaryBefore, binaryAfter }),
    [before, after, renames, binaryBefore, binaryAfter],
  );
  const [open, setOpen] = useState<ReadonlySet<string>>(
    () => new Set(changes.length <= openLimit ? changes.map((c) => c.path) : []),
  );
  if (changes.length === 0)
    return <p className="text-sm text-[var(--text-mut)]">{t("changes.empty")}</p>;
  const added = changes.reduce((n, c) => n + c.added, 0);
  const removed = changes.reduce((n, c) => n + c.removed, 0);
  const allOpen = changes.every((c) => open.has(c.path));
  const toggle = (path: string) =>
    setOpen((s) => {
      const next = new Set(s);
      if (!next.delete(path)) next.add(path);
      return next;
    });
  return (
    <div className={cn("flex min-w-0 flex-col gap-2", className)}>
      <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-[13px]">
        <span className="font-medium text-[var(--text)]">
          {t("changes.files", { count: changes.length })}
        </span>
        <span className="font-mono text-[var(--success)]">+{added}</span>
        <span className="font-mono text-[var(--danger)]">−{removed}</span>
        <button
          type="button"
          className="btn btn-sm btn-ghost ml-auto"
          onClick={() => setOpen(new Set(allOpen ? [] : changes.map((c) => c.path)))}
        >
          {allOpen ? t("changes.collapseAll") : t("changes.expandAll")}
        </button>
      </div>
      {changes.map((change) => (
        <div
          key={change.path}
          className="min-w-0 overflow-clip rounded-[var(--r-md)] border border-[var(--border)]"
        >
          <button
            type="button"
            aria-expanded={open.has(change.path)}
            onClick={() => toggle(change.path)}
            className="sticky top-0 z-10 flex w-full min-w-0 items-center gap-2 bg-[var(--surface-raised)] px-3 py-2 text-left text-xs hover:bg-[var(--surface-hover)]"
          >
            <ChevronRight
              size={14}
              aria-hidden
              className={cn("shrink-0 transition-transform", open.has(change.path) && "rotate-90")}
            />
            <span className={cn("badge shrink-0", STATUS_BADGE[change.status])}>
              {t(`changes.status.${change.status}`)}
            </span>
            <span
              className="min-w-0 flex-1 truncate font-mono text-[var(--text)]"
              title={change.path}
            >
              {change.path}
              {change.from ? (
                <span className="ml-2 text-[var(--text-mut)]">
                  {t("changes.renamedFrom", { from: change.from })}
                </span>
              ) : null}
            </span>
            {!change.binary && (
              <span className="shrink-0 font-mono">
                <span className="text-[var(--success)]">+{change.added}</span>{" "}
                <span className="text-[var(--danger)]">−{change.removed}</span>
              </span>
            )}
          </button>
          {open.has(change.path) &&
            (change.binary ? (
              <p className="p-3 text-xs text-[var(--text-mut)]">{t("changes.binary")}</p>
            ) : (
              <div className="p-2">
                <FileDiff
                  before={change.before}
                  after={change.after}
                  beforeLabel={beforeLabel}
                  afterLabel={afterLabel}
                  wrap
                />
              </div>
            ))}
        </div>
      ))}
    </div>
  );
}
