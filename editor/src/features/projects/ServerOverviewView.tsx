import { DEFAULT_MODULE_ICON, ModuleRowIcon, useModuleBrand } from "@/components/ArtisanWordmark";
import { relTime } from "@/components/LinkedServersDropdown";
import { Badge } from "@/components/ui/badge";
import { cx } from "@/lib/cx";
import { projectDestination, screenDestination } from "@/lib/projectNavigation";
import { Link } from "@tanstack/react-router";
import { ChevronRight, Folder } from "lucide-react";
import type * as React from "react";
import { Trans, useTranslation } from "react-i18next";
import type { ActivityEntry, DeployedVersion, ModuleLine } from "./serverOverview";

/**
 * The overview tab of a server: what the sidebar does not say. A few figures, the player's
 * changes waiting to go out, every module with where it comes from and when it last went out,
 * and the latest deployments. Navigation stays the sidebar's: no list of screens here.
 *
 * Presentational: the route reads the server and hands the lines over.
 */
export function ServerOverviewView({
  serverId,
  lines,
  activity,
  players,
  lastDeploy,
  versionOf,
  listing,
  actions,
  onReview,
}: {
  serverId: string;
  lines: readonly ModuleLine[];
  activity: readonly ActivityEntry[] | null;
  /** Players online; null when the server is offline. */
  players: number | null;
  lastDeploy: DeployedVersion | null;
  /** The version of a plugin module, as its server announced it. */
  versionOf: (moduleId: string) => string | null;
  /** Shown in place of the table while the folders are read, or when they cannot be. */
  listing: React.ReactNode | null;
  /** The table's actions (import, new module). */
  actions: React.ReactNode;
  onReview: () => void;
}) {
  const { t, i18n } = useTranslation();
  const pending = lines.filter((line) => line.pending > 0);
  const addons = lines.filter((line) => line.kind === "addon").length;
  const when = (iso: string) => relTime(iso, i18n.language);
  const who = (version: DeployedVersion) =>
    version.author?.name ?? t("serverDetail.overview.theServer");

  return (
    <div className="grid gap-x-7 gap-y-7 xl:grid-cols-[minmax(0,1fr)_340px]">
      <div
        className="grid grid-cols-2 gap-2.5 sm:flex sm:flex-wrap xl:col-span-2"
        data-testid="overview-figures"
      >
        <Figure
          value={players === null ? "—" : String(players)}
          label={t(
            players === null
              ? "serverDetail.overview.playersOffline"
              : "serverDetail.overview.players",
          )}
        />
        <Figure
          value={listing ? "—" : String(lines.length)}
          label={
            listing
              ? t("serverDetail.overview.modules")
              : `${t("serverDetail.overview.modules")} · ${t("serverDetail.overview.modulesSplit", {
                  addons,
                  mine: lines.length - addons,
                })}`
          }
        />
        <Figure
          value={String(pending.length)}
          label={t("serverDetail.overview.toDeploy")}
          warn={pending.length > 0}
        />
        <Figure
          value={lastDeploy ? when(lastDeploy.createdAt) : t("serverDetail.overview.never")}
          label={t("serverDetail.overview.lastDeploy")}
        />
      </div>

      <div className="flex min-w-0 flex-col gap-7">
        {pending.length > 0 && (
          <Section title={t("serverDetail.overview.pendingTitle")} count={pending.length}>
            <div className="card overflow-hidden border-[var(--warning)]/40 p-0">
              <div className="flex flex-wrap items-center gap-x-3 gap-y-2 border-b border-[var(--border-soft)] px-4 py-3">
                <span aria-hidden className="size-2 shrink-0 rounded-full bg-[var(--warning)]" />
                <span className="min-w-0 grow basis-60 text-[13px] text-[var(--text-mut)]">
                  {t("serverDetail.overview.pendingHint")}
                </span>
                <button type="button" className="btn btn-primary btn-sm" onClick={onReview}>
                  {t("serverDetail.overview.review")}
                </button>
              </div>
              <ul>
                {pending.map((line) => (
                  <li
                    key={line.key}
                    className="border-t border-[var(--border-soft)] first:border-t-0"
                  >
                    <Link
                      {...lineDestination(line, serverId)}
                      className={cx(PENDING_GRID, ROW_BASE)}
                    >
                      <LineIcon line={line} />
                      <span className="min-w-0 truncate font-medium text-[var(--text)]">
                        {line.label}
                      </span>
                      <span className="min-w-0 flex-1 truncate text-[var(--text-mut)]">
                        {t("serverDetail.overview.files", { count: line.pending })}
                      </span>
                      <RowChevron />
                    </Link>
                  </li>
                ))}
              </ul>
            </div>
          </Section>
        )}

        <Section
          title={t("serverDetail.overview.modulesTitle")}
          count={listing ? undefined : lines.length}
          actions={actions}
        >
          {listing ?? (
            <div className="card overflow-hidden p-0">
              <div
                aria-hidden
                className={cx(
                  TABLE_GRID,
                  "border-b border-[var(--border-soft)] px-4 py-2 text-[12px] text-[var(--text-faint)]",
                )}
              >
                <span />
                <span>{t("serverDetail.overview.columnModule")}</span>
                <span className="max-md:hidden">{t("serverDetail.overview.columnOrigin")}</span>
                <span className="max-sm:hidden">{t("serverDetail.overview.columnLastDeploy")}</span>
                <span>{t("serverDetail.overview.columnState")}</span>
                <span />
              </div>
              <ul data-testid="overview-modules">
                {lines.map((line) => {
                  const version = line.moduleId ? versionOf(line.moduleId) : null;
                  return (
                    <li
                      key={line.key}
                      className="border-t border-[var(--border-soft)] first:border-t-0"
                    >
                      <Link
                        {...lineDestination(line, serverId)}
                        className={cx(TABLE_GRID, ROW_BASE)}
                      >
                        <LineIcon line={line} />
                        <span className="min-w-0 truncate font-medium text-[var(--text)]">
                          {line.label}
                        </span>
                        <span className="min-w-0 truncate text-[var(--text-mut)] max-md:hidden">
                          {line.kind === "addon" ? (
                            <>
                              {t("serverDetail.overview.addon")}
                              {version && (
                                <span
                                  className="ml-1.5 text-[12px]"
                                  style={{ fontFamily: "var(--font-mono)" }}
                                >
                                  {version}
                                </span>
                              )}
                              {line.projects.length > 1 &&
                                ` · ${t("serverDetail.overview.folders", { count: line.projects.length })}`}
                            </>
                          ) : (
                            t("serverDetail.overview.content")
                          )}
                        </span>
                        <span
                          className={cx(
                            "min-w-0 truncate max-sm:hidden",
                            line.lastDeploy ? "text-[var(--text-mut)]" : "text-[var(--text-faint)]",
                          )}
                        >
                          {line.lastDeploy === undefined
                            ? "…"
                            : line.lastDeploy === null
                              ? line.projects.length === 0
                                ? "—"
                                : t("serverDetail.overview.neverDeployed")
                              : t("serverDetail.overview.by", {
                                  when: when(line.lastDeploy.createdAt),
                                  who: who(line.lastDeploy),
                                })}
                        </span>
                        <span>
                          {line.pending > 0 && (
                            <Badge variant="amber">
                              {t("serverDetail.overview.pending", { count: line.pending })}
                            </Badge>
                          )}
                        </span>
                        <RowChevron />
                      </Link>
                    </li>
                  );
                })}
              </ul>
            </div>
          )}
        </Section>
      </div>

      <Section title={t("serverDetail.overview.activityTitle")}>
        <div className="card p-0">
          {activity === null ? (
            <p className="px-4 py-3 text-[13px] text-[var(--text-faint)]">…</p>
          ) : activity.length === 0 ? (
            <p className="px-4 py-3 text-[13px] text-[var(--text-faint)]">
              {t("serverDetail.overview.activityNone")}
            </p>
          ) : (
            <ul className="flex flex-col py-1" data-testid="overview-activity">
              {activity.map((entry) => (
                <li
                  key={entry.key}
                  className="grid grid-cols-[26px_minmax(0,1fr)_auto] items-start gap-2.5 px-4 py-2.5"
                >
                  <span
                    aria-hidden
                    className="grid size-[26px] place-items-center rounded-full bg-[var(--brand-soft)] text-[12px] font-semibold text-[var(--brand)]"
                  >
                    {(entry.version.author?.name ?? "⚙").charAt(0).toUpperCase()}
                  </span>
                  <div className="min-w-0 text-[13px] text-[var(--text-mut)] [&_strong]:font-semibold [&_strong]:text-[var(--text)]">
                    <p className="min-w-0">
                      <Trans
                        i18nKey={
                          entry.version.author
                            ? "serverDetail.overview.deployed"
                            : "serverDetail.overview.reloaded"
                        }
                        values={{ who: entry.version.author?.name, module: entry.label }}
                      />
                    </p>
                    <p
                      className="truncate text-[11.5px] text-[var(--text-faint)]"
                      style={{ fontFamily: "var(--font-mono)" }}
                      title={entry.version.changed.join("\n")}
                    >
                      {filesLine(
                        entry.version.changed,
                        t("serverDetail.overview.more", {
                          count: entry.version.changed.length - 2,
                        }),
                      )}
                    </p>
                  </div>
                  <span className="whitespace-nowrap text-[11.5px] text-[var(--text-faint)]">
                    {when(entry.version.createdAt)}
                  </span>
                </li>
              ))}
            </ul>
          )}
        </div>
      </Section>
    </div>
  );
}

/** The first two files of a Version, then how many more. */
function filesLine(changed: readonly string[], more: string): string {
  const shown = changed.slice(0, 2).join(", ");
  return changed.length > 2 ? `${shown} ${more}` : shown;
}

/** Where a module's row leads: its folder, else the first screen it manages. */
export function lineDestination(line: ModuleLine, serverId: string) {
  const [project] = line.projects;
  if (project) return projectDestination(project, serverId);
  const [entry] = line.entries;
  if (entry?.kind === "screen") return screenDestination(entry.screen, serverId, line.projects);
  if (entry?.kind === "config")
    return { to: "/m/$moduleId" as const, params: { moduleId: entry.moduleId } };
  return { to: "/servers/$serverId" as const, params: { serverId } };
}

const ROW_BASE =
  "group items-center gap-3 px-4 py-2.5 text-[13.5px] transition-colors hover:bg-[var(--surface-hover)]";
/** Icon, name, files, chevron: the names line up as a column. */
const PENDING_GRID =
  "grid grid-cols-[16px_minmax(0,1fr)_auto_14px] gap-3 sm:grid-cols-[16px_minmax(0,11rem)_minmax(0,1fr)_14px]";
/** Icon, name, origin, last deployment, state, chevron: the header and every row line up. */
const TABLE_GRID =
  "grid grid-cols-[16px_minmax(0,1fr)_120px_14px] sm:grid-cols-[16px_minmax(0,1fr)_minmax(0,1.2fr)_120px_14px] md:grid-cols-[16px_minmax(0,1.1fr)_minmax(0,1fr)_minmax(0,1.2fr)_120px_14px] gap-3";

function LineIcon({ line }: { line: ModuleLine }) {
  const brand = useModuleBrand(line.moduleId);
  if (line.kind === "content")
    return <Folder aria-hidden className="size-4 shrink-0 text-[var(--text-mut)]" />;
  return <ModuleRowIcon src={brand?.icon ?? DEFAULT_MODULE_ICON} />;
}

function RowChevron() {
  return (
    <ChevronRight className="size-3.5 shrink-0 text-[var(--text-faint)] transition-transform group-hover:translate-x-0.5 group-hover:text-[var(--brand)]" />
  );
}

function Figure({ value, label, warn = false }: { value: string; label: string; warn?: boolean }) {
  return (
    <div className="card min-w-0 px-4 py-3 sm:min-w-40">
      <p
        className={cx(
          "text-[20px] leading-tight font-semibold tabular-nums",
          warn ? "text-[var(--warning)]" : "text-[var(--text)]",
        )}
      >
        {value}
      </p>
      <p className="mt-0.5 text-[12.5px] text-[var(--text-mut)]">{label}</p>
    </div>
  );
}

/** An overview section: eyebrow title, its count, a rule, then its actions. */
function Section({
  title,
  count,
  actions,
  children,
}: {
  title: string;
  count?: number;
  actions?: React.ReactNode;
  children: React.ReactNode;
}) {
  return (
    <section className="flex min-w-0 flex-col gap-3">
      <div className="flex min-h-8 flex-wrap items-center gap-x-3 gap-y-2">
        <h2 className="eyebrow">{title}</h2>
        {count !== undefined && (
          <span className="text-[12px] tabular-nums text-[var(--text-faint)]">{count}</span>
        )}
        <span className="h-px flex-1 bg-[var(--border-soft)]" />
        {actions && (
          <div className="flex min-w-0 flex-wrap items-center gap-2 [&_.btn]:whitespace-nowrap">
            {actions}
          </div>
        )}
      </div>
      {children}
    </section>
  );
}
