import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { SortableList } from "@/components/ui/sortable-list";
import { KIT_FOLDER } from "@/lib/pack/kit";
import { themesMoved } from "@/lib/pack/theme";
import { useKitStore } from "@/state/kitStore";
import { type ReactNode, useMemo, useState } from "react";
import { useTranslation } from "react-i18next";
import { publishedKitTheme } from "./kitAssets";
import { serverThemeNames } from "./kitTheme";

const ROW =
  "flex items-center gap-2 rounded-[var(--r-md)] bg-[var(--surface-inset)] p-2 text-[13px]";

/**
 * The server's themes (ADR `common-images-and-themes`, decision 12): the stack in place, the
 * highest first, as it decides what a player sees, then the themes the server holds that are
 * not in place. The stack is reordered here (`onOrder`), a theme put in place or taken off
 * (`onPutInPlace`), and one opened on its page (`onTheme`). Read from the published server.
 */
export function ThemesPage({
  onTheme,
  onOrder,
  onPutInPlace,
  newTheme,
}: {
  /** Opens the theme `name` on its page. */
  onTheme: (name: string) => void;
  /** Writes the themes in place, the lowest first, and rebuilds the server's pack. */
  onOrder?: (themes: string[]) => Promise<void>;
  /** Puts the theme `name` in place above the others (`put`), or takes it off. */
  onPutInPlace?: (name: string, put: boolean) => Promise<void>;
  /** What adds a theme to the server (a new one, one from an archive), given the names its themes have. */
  newTheme?: (themes: readonly string[]) => ReactNode;
}) {
  const { t } = useTranslation();
  const read = useKitStore((s) => s.read);
  const own = useKitStore((s) => s.own);
  const inPlace = useKitStore((s) => s.themes);
  const stacks = useKitStore((s) => s.stacks);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const held = useMemo(() => serverThemeNames(read, own), [read, own]);
  // The highest first: what is on top of the list is on top of the others.
  const stack = useMemo(() => [...inPlace].reverse(), [inPlace]);
  const others = held.filter((name) => !inPlace.includes(name));

  const run = async (change: () => Promise<void>) => {
    if (busy) return;
    setBusy(true);
    setError(null);
    try {
      await change();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : String(cause));
    } finally {
      setBusy(false);
    }
  };

  /** What the theme `name` changes, in a few words; `null` when the server holds none of that name. */
  const summary = (name: string): string | null => {
    const theme = publishedKitTheme(read, name, own);
    if (!theme) return null;
    const parts: string[] = [];
    if (theme.colors.size > 0) parts.push(t("kit.themes.colors", { count: theme.colors.size }));
    const drawn = theme.drawings.length + theme.moduleDrawings.length;
    if (drawn > 0) parts.push(t("kit.themes.drawings", { count: drawn }));
    if (theme.scope !== null)
      parts.push(
        theme.scope === KIT_FOLDER
          ? t("kit.themes.scopeCommon")
          : t("kit.themes.scopeModule", { module: theme.scope }),
      );
    return parts.length > 0 ? parts.join(" · ") : t("kit.themes.empty");
  };

  const row = (name: string, handle: ReactNode, action: ReactNode, rank?: number) => {
    const what = summary(name);
    return (
      <>
        {handle}
        {rank !== undefined ? (
          <span className="w-5 shrink-0 text-center text-[12px] text-[var(--text-faint)]">
            {rank}
          </span>
        ) : null}
        <div className="flex min-w-0 flex-1 flex-col">
          <button
            type="button"
            className="truncate text-left font-medium hover:underline"
            onClick={() => onTheme(name)}
          >
            {name}
          </button>
          <span className="truncate text-[12px] text-[var(--text-mut)]">
            {what ?? t("kit.themes.missing")}
          </span>
        </div>
        {what === null ? <Badge variant="amber">{t("kit.themes.missingBadge")}</Badge> : null}
        {action}
      </>
    );
  };

  const takeOff = (name: string) =>
    onPutInPlace ? (
      <Button
        size="sm"
        variant="outline"
        disabled={busy}
        onClick={() => void run(() => onPutInPlace(name, false))}
      >
        {t("kit.themes.takeOff")}
      </Button>
    ) : null;

  return (
    <div className="flex flex-col gap-4" data-testid="themes-page">
      <header className="flex flex-wrap items-start gap-3">
        <div className="flex min-w-0 flex-1 flex-col gap-1">
          <h2 className="text-lg font-semibold">{t("kit.themes.title")}</h2>
          <p className="text-[13px] text-[var(--text-mut)]">{t("kit.themes.intro")}</p>
        </div>
        {newTheme?.(held)}
      </header>
      {error ? (
        <p role="alert" className="text-xs text-[var(--danger)]">
          {t("kit.theme.failed", { detail: error })}
        </p>
      ) : null}

      <section className="card flex flex-col gap-2 p-4" data-testid="themes-in-place">
        <h3 className="eyebrow">{t("kit.themes.inPlace")}</h3>
        <p className="text-[12px] text-[var(--text-mut)]">
          {t(stack.length > 1 ? "kit.themes.orderHint" : "kit.themes.inPlaceHint")}
        </p>
        {stack.length === 0 ? (
          <p className="text-[13px] text-[var(--text-mut)]">{t("kit.themes.noneInPlace")}</p>
        ) : stacks && onOrder && stack.length > 1 ? (
          <SortableList
            ids={stack}
            onMove={(from, to) => void run(() => onOrder(themesMoved(inPlace, from, to)))}
            className="flex flex-col gap-1.5"
            itemClassName={ROW}
            handleLabel={t("kit.themes.move")}
          >
            {(index, handle) => {
              const name = stack[index] as string;
              return row(name, handle, takeOff(name), index + 1);
            }}
          </SortableList>
        ) : (
          <ul className="flex flex-col gap-1.5">
            {stack.map((name) => (
              <li key={name} className={ROW}>
                {row(name, null, takeOff(name))}
              </li>
            ))}
          </ul>
        )}
        <div className={`${ROW} text-[var(--text-mut)]`} data-testid="themes-base">
          <div className="flex min-w-0 flex-1 flex-col">
            <span className="font-medium">{t("kit.themes.base")}</span>
            <span className="text-[12px]">{t("kit.themes.baseHint")}</span>
          </div>
        </div>
      </section>

      <section className="card flex flex-col gap-2 p-4" data-testid="themes-installed">
        <h3 className="eyebrow">{t("kit.themes.installed")}</h3>
        {others.length === 0 ? (
          <p className="text-[13px] text-[var(--text-mut)]">
            {t(held.length === 0 ? "kit.themes.none" : "kit.themes.allInPlace")}
          </p>
        ) : (
          <ul className="flex flex-col gap-1.5">
            {others.map((name) => (
              <li key={name} className={ROW}>
                {row(
                  name,
                  null,
                  onPutInPlace ? (
                    <Button
                      size="sm"
                      disabled={busy}
                      onClick={() => void run(() => onPutInPlace(name, true))}
                    >
                      {t("kit.themes.putInPlace")}
                    </Button>
                  ) : null,
                )}
              </li>
            ))}
          </ul>
        )}
        <p className="text-[12px] text-[var(--text-mut)]">{t("kit.themes.putHint")}</p>
      </section>
    </div>
  );
}
