import { Badge } from "@/components/ui/badge";
import { SortableList } from "@/components/ui/sortable-list";
import { NewThemeDialog } from "@/features/assets/NewThemeDialog";
import { publishedKitTheme } from "@/features/assets/kitAssets";
import { serverThemeNames } from "@/features/assets/kitTheme";
import { useServerIndexRereads } from "@/features/serverIndex/serverIndexRereads";
import { useServerIndexStore } from "@/features/serverIndex/serverIndexStore";
import { patchServerConfig } from "@/lib/api/serverConfig";
import { cx } from "@/lib/cx";
import { THEMES_CONFIG_KEY, themeChange, themesMoved } from "@/lib/pack/theme";
import { useKitStore } from "@/state/kitStore";
import { useNavigate } from "@tanstack/react-router";
import { type ReactNode, useMemo, useState } from "react";
import { useTranslation } from "react-i18next";
import { rebuildServerPackInBackground } from "./resourcePackSync";

/**
 * A place a resource lives in (ADR `resources-one-screen`, decision 1): a theme of the server,
 * the base (the theme `artisan`: Artisan's images and the server's own, in one place), or a
 * module.
 */
export type ResourcePlace =
  | { kind: "theme"; name: string }
  | { kind: "server" }
  | { kind: "module"; id: string };

/** Draws what imports a theme: the server it goes to, the names taken, and what to do once it is there. */
export type ThemeImporter = (props: {
  serverKeyId: string;
  taken: readonly string[];
  onImported: (name: string) => void;
}) => ReactNode;

const ROW = "flex min-h-9 items-center gap-1.5 rounded-[var(--r-md)] px-2 py-1 text-[13px]";
const ACTION =
  "shrink-0 rounded-[var(--r-sm)] px-1.5 py-0.5 text-[11px] text-[var(--text-mut)] hover:bg-[var(--surface-inset)] hover:text-[var(--text)] disabled:opacity-50";

/**
 * The places of the server's resources, always visible beside the place that is open (ADR
 * `resources-one-screen`, decision 5): its themes in place from the highest down (reordered by
 * dragging), the server's own theme under them, the themes put away, then the modules and
 * Artisan's base. The same list from the server's Resources and from a module's: a click opens
 * the place (a theme of its own folder, a module and the server's theme in their Project). A theme is put in place, put away, created and imported from here.
 */
export function ResourcePlaces({
  serverId,
  serverKeyId,
  selected,
  importTheme,
}: {
  /** The server as links carry it. */
  serverId: string;
  /** The server's key id, which its configuration is written under. */
  serverKeyId: string;
  selected: ResourcePlace | null;
  /** What brings a theme from an archive onto the server, given by the page (`features/import`). */
  importTheme?: ThemeImporter;
}) {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const read = useKitStore((s) => s.read);
  const own = useKitStore((s) => s.own);
  const inPlace = useKitStore((s) => s.themes);
  const stacks = useKitStore((s) => s.stacks);
  const every = useServerIndexStore((s) => s.projects);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const held = useMemo(() => serverThemeNames(read, own), [read, own]);
  // The highest first: what is on top of the list is found first.
  const stack = useMemo(() => [...inPlace].reverse(), [inPlace]);
  const away = held.filter((name) => !inPlace.includes(name));
  const modules = useMemo(() => {
    const themeIds = new Set(Object.values(own).map((theme) => theme.projectId));
    return every.filter((p) => p.id !== read?.projectId && !themeIds.has(p.id));
  }, [every, read, own]);

  const open = (place: ResourcePlace) => {
    // A theme of its own folder is edited in its Project, like a module; one the common images
    // still keep has its page alone.
    const mine = place.kind === "theme" ? own[place.name]?.projectId : undefined;
    if (place.kind === "theme" && !mine)
      return void navigate({
        to: "/servers/$serverId/resources",
        params: { serverId },
        search: { theme: place.name },
      });
    const projectId =
      place.kind === "theme" ? mine : place.kind === "server" ? read?.projectId : place.id;
    if (!projectId) return;
    void navigate({
      to: "/servers/$serverId/projects/$projectId",
      params: { serverId, projectId },
      search: { tab: "resources" },
    });
  };
  const is = (place: ResourcePlace) =>
    !!selected &&
    selected.kind === place.kind &&
    (place.kind === "theme"
      ? (selected as { name: string }).name === place.name
      : place.kind === "module"
        ? (selected as { id: string }).id === place.id
        : true);

  const run = async (change: () => Promise<Record<string, unknown>>) => {
    if (busy) return;
    setBusy(true);
    setError(null);
    try {
      // The common images are shown in the server's themes from now on, and its pack rebuilt in them.
      useKitStore.getState().readConfig(await change());
      rebuildServerPackInBackground(t, serverKeyId);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : String(cause));
    } finally {
      setBusy(false);
    }
  };
  const put = (name: string, on: boolean) =>
    void run(() => {
      const { themes, stacks: lists } = useKitStore.getState();
      return patchServerConfig(serverKeyId, themeChange(themes, lists, name, on));
    });
  // A theme just made is not read yet: its page says so until it is, and leads to its files.
  const arrived = (name: string) => {
    useServerIndexRereads.getState().bump();
    void navigate({
      to: "/servers/$serverId/resources",
      params: { serverId },
      search: { theme: name },
    });
  };

  const entry = (
    place: ResourcePlace,
    name: string,
    detail: string | null,
    extra?: ReactNode,
    handle?: ReactNode,
  ) => (
    <div
      className={cx(ROW, is(place) && "bg-[var(--brand-soft)]")}
      data-testid={`place-${place.kind}${"name" in place ? `-${place.name}` : "id" in place ? `-${place.id}` : ""}`}
      aria-current={is(place) ? "true" : undefined}
    >
      {handle}
      <button
        type="button"
        className="flex min-w-0 flex-1 flex-col text-left"
        onClick={() => open(place)}
      >
        <span className={cx("truncate font-medium", is(place) && "text-[var(--brand)]")}>
          {name}
        </span>
        {detail ? (
          <span className="truncate text-[11px] text-[var(--text-mut)]">{detail}</span>
        ) : null}
      </button>
      {extra}
    </div>
  );
  /** What the theme `name` holds, in a few words; `null` when the server holds none of that name. */
  const summary = (name: string): string | null => {
    const theme = publishedKitTheme(read, name, own);
    if (!theme) return null;
    return theme.drawings.length > 0
      ? t("places.images", { count: theme.drawings.length })
      : t("places.emptyTheme");
  };
  const themeInPlace = (name: string, handle?: ReactNode) => {
    const what = summary(name);
    return entry(
      { kind: "theme", name },
      name,
      what ?? t("places.missing"),
      <>
        {what === null ? <Badge variant="amber">{t("places.missingBadge")}</Badge> : null}
        <button type="button" className={ACTION} disabled={busy} onClick={() => put(name, false)}>
          {t("places.putAway")}
        </button>
      </>,
      handle,
    );
  };

  return (
    <nav
      className="flex max-h-[40vh] min-h-0 w-full shrink-0 flex-col gap-3 overflow-y-auto lg:max-h-none border-[var(--border)] border-b p-3 lg:h-full lg:w-64 lg:border-r lg:border-b-0"
      aria-label={t("places.label")}
      data-testid="resource-places"
    >
      <section className="flex flex-col gap-1" data-testid="places-themes">
        <h3 className="eyebrow">{t("places.themes")}</h3>
        <p className="text-[11px] text-[var(--text-mut)]">{t("places.themesHint")}</p>
        {error ? (
          <p role="alert" className="text-[11px] text-[var(--danger)]">
            {t("kit.theme.failed", { detail: error })}
          </p>
        ) : null}
        {stacks && stack.length > 1 ? (
          <SortableList
            ids={stack}
            onMove={(from, to) =>
              void run(() =>
                patchServerConfig(serverKeyId, {
                  [THEMES_CONFIG_KEY]: themesMoved(useKitStore.getState().themes, from, to),
                }),
              )
            }
            className="flex flex-col gap-0.5"
            handleLabel={t("places.move")}
          >
            {(index, handle) => themeInPlace(stack[index] as string, handle)}
          </SortableList>
        ) : (
          stack.map((name) => <div key={name}>{themeInPlace(name)}</div>)
        )}
        {read ? entry({ kind: "server" }, t("places.server"), t("places.serverHint")) : null}
        {away.map((name) => (
          <div key={name}>
            {entry(
              { kind: "theme", name },
              name,
              summary(name),
              <>
                <Badge variant="sage">{t("places.away")}</Badge>
                <button
                  type="button"
                  className={ACTION}
                  disabled={busy}
                  onClick={() => put(name, true)}
                >
                  {t("places.putInPlace")}
                </button>
              </>,
            )}
          </div>
        ))}
        {read ? (
          <div className="flex flex-wrap gap-1.5 pt-1">
            <NewThemeDialog serverKeyId={serverKeyId} taken={held} onCreated={arrived} />
            {importTheme?.({ serverKeyId, taken: held, onImported: arrived })}
          </div>
        ) : null}
      </section>

      <section className="flex flex-col gap-1" data-testid="places-modules">
        <h3 className="eyebrow">{t("places.modules")}</h3>
        <p className="text-[11px] text-[var(--text-mut)]">{t("places.modulesHint")}</p>
        {modules.length === 0 ? (
          <p className="text-[12px] text-[var(--text-faint)]">{t("places.noModules")}</p>
        ) : (
          modules.map((p) => (
            <div key={p.id}>{entry({ kind: "module", id: p.id }, p.name, null)}</div>
          ))
        )}
      </section>
    </nav>
  );
}

/**
 * Above the Resources of a theme's Project: which theme this is, whether it is in place, and
 * the way to its page (what it looks like in a menu, put in place, rename, delete, export).
 */
export function ThemeBar({
  name,
  onSettings,
}: { name: string; onSettings: (name: string) => void }) {
  const { t } = useTranslation();
  const inPlace = useKitStore((s) => s.themes.includes(name));
  return (
    <div
      className="flex shrink-0 flex-wrap items-center gap-2 border-[var(--border)] border-b px-3 py-2 text-[13px]"
      data-testid="theme-bar"
    >
      <span className="font-medium">{t("places.themeBar", { name })}</span>
      <Badge variant={inPlace ? "sage" : "amber"}>
        {t(inPlace ? "places.themeInPlace" : "places.themeAway")}
      </Badge>
      <button
        type="button"
        className="ml-auto text-[12px] text-[var(--brand)] hover:underline"
        onClick={() => onSettings(name)}
      >
        {t("places.themeSettings")}
      </button>
    </div>
  );
}
