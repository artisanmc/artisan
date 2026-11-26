import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { KIT_PREFIX } from "@/lib/pack/kit";
import { themeUnread } from "@/lib/pack/theme";
import { useKitStore } from "@/state/kitStore";
import { useMemo, useState } from "react";
import { useTranslation } from "react-i18next";
import { AssetPreview } from "./AssetPreview";
import { KitTrialMenu } from "./KitTrialMenu";
import { ThemeMoves } from "./ThemeMoves";
import { publishedKitTheme, useKitAssetsIn, useThemeOwnImages } from "./kitAssets";
import { serverThemeNames } from "./kitTheme";

/**
 * One theme of the server's kit (`lib/pack/theme.ts`), read from the published kit module: the
 * pieces it redraws, its own images (what a menu writes
 * `<theme>:<name>` for) and the same menu without it and with it. A theme is put in place
 * from here (`onPutInPlace`: on top of the server's `resource-pack.themes`, then its pack
 * rebuilt), and taken off the same way.
 *
 * A theme of its own folder is renamed and deleted from here too (`onRename`, `onDelete`),
 * when the server moves a theme's folder, and exported as an archive (`onExport`). What it
 * still holds that is no longer read (a table of colours, a redraw aimed at a module:
 * `themeUnread`) is said.
 */
export function KitThemePage({
  name,
  onBack,
  backLabel,
  onPutInPlace,
  onOpenKit,
  onOpenTheme,
  onRename,
  onDelete,
  onExport,
}: {
  name: string;
  onBack: () => void;
  /** What the way back says; absent: back to the common images. */
  backLabel?: string;
  /** Puts the theme `name` in place on the server, above the ones that are (`put`), or takes it off. */
  onPutInPlace?: (name: string, put: boolean) => Promise<void>;
  /** Opens the common images' Project, where the files of a theme it still keeps are. */
  onOpenKit?: () => void;
  /** Opens the Project of a theme of its own folder: its files, and a draft of it to deploy. */
  onOpenTheme?: () => void;
  /** Renames the theme `name`, a theme of its own folder, to `target`. */
  onRename?: (name: string, target: string) => Promise<void>;
  /** Takes the theme `name`, a theme of its own folder, off the server. */
  onDelete?: (name: string) => Promise<void>;
  /**
   * Downloads the archive of the theme `name`, a theme of its own folder; rejects with why it
   * could not (`server_offline`, `transport`).
   */
  onExport?: (name: string) => Promise<void>;
}) {
  const { t } = useTranslation();
  const read = useKitStore((s) => s.read);
  const own = useKitStore((s) => s.own);
  const stack = useKitStore((s) => s.themes);
  const inPlace = stack.includes(name);
  const theme = useMemo(() => publishedKitTheme(read, name, own), [read, own, name]);
  const plain = useKitAssetsIn(null);
  const themed = useKitAssetsIn(name);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const mine = own[name];
  const unread = useMemo(
    () =>
      mine ? themeUnread([...Object.keys(mine.files), ...mine.binaries.map((b) => b.path)]) : [],
    [mine],
  );
  const moves = own[name]?.canMove === true;
  const taken = useMemo(() => serverThemeNames(read, own), [read, own]);
  const ownImages = useThemeOwnImages(name);

  const put = async (next: boolean) => {
    if (busy || !onPutInPlace) return;
    setBusy(true);
    setError(null);
    try {
      await onPutInPlace(name, next);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : String(cause));
    } finally {
      setBusy(false);
    }
  };

  const exportIt = async () => {
    if (busy || !onExport) return;
    setBusy(true);
    setError(null);
    try {
      await onExport(name);
    } catch (cause) {
      setError(`export:${cause instanceof Error ? cause.message : "transport"}`);
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="flex flex-col gap-4" data-testid="kit-theme-page">
      <header className="flex flex-wrap items-center gap-3">
        <Button variant="outline" onClick={onBack}>
          {backLabel ?? t("kit.theme.back")}
        </Button>
        <div className="flex min-w-0 flex-1 flex-col gap-0.5">
          <h2 className="text-lg font-semibold">{t("kit.theme.title", { name })}</h2>
          <p className="text-[13px] text-[var(--text-mut)]">{t("kit.theme.intro")}</p>
        </div>
        {theme ? (
          <>
            <Badge variant={inPlace ? "sage" : "amber"}>
              {t(inPlace ? "kit.theme.inPlace" : "kit.theme.notInPlace")}
            </Badge>
            {onPutInPlace ? (
              <Button
                variant={inPlace ? "outline" : "default"}
                disabled={busy}
                onClick={() => void put(!inPlace)}
              >
                {t(inPlace ? "kit.theme.takeOff" : "kit.theme.putInPlace")}
              </Button>
            ) : null}
          </>
        ) : null}
      </header>
      {error ? (
        <p role="alert" className="text-xs text-[var(--danger)]">
          {error.startsWith("export:")
            ? t(`kit.theme.exportFailed.${error.slice(7)}`, {
                defaultValue: t("kit.theme.exportFailed.transport"),
              })
            : t("kit.theme.failed", { detail: error })}
        </p>
      ) : null}
      {inPlace && stack.length > 1 ? (
        <p className="text-[13px] text-[var(--text-mut)]" data-testid="kit-theme-stack">
          {t("kit.theme.stack", { themes: stack.join(", ") })}
        </p>
      ) : null}
      {!theme ? (
        <p className="text-[13px] text-[var(--text-mut)]">{t("kit.theme.missing", { name })}</p>
      ) : (
        <div className="flex flex-col gap-5 xl:flex-row xl:items-start">
          <div className="flex w-full shrink-0 flex-col gap-4 xl:w-[340px]">
            <section className="card flex flex-col gap-2 p-4">
              <h3 className="eyebrow">{t("kit.theme.drawings")}</h3>
              {theme.drawings.length === 0 ? (
                <p className="text-xs text-[var(--text-mut)]">{t("kit.theme.noDrawings")}</p>
              ) : (
                <ul className="flex flex-col gap-1.5" data-testid="kit-theme-drawings">
                  {theme.drawings.map((piece) => {
                    const shown = themed.find((a) => a.id === KIT_PREFIX + piece);
                    return (
                      <li
                        key={piece}
                        className="flex items-center gap-2 rounded-[var(--r-md)] bg-[var(--surface-inset)] p-1.5 text-xs"
                      >
                        <span className="flex h-9 w-14 shrink-0 items-center justify-center">
                          {shown ? (
                            <AssetPreview
                              asset={shown}
                              className="max-h-full max-w-full object-contain"
                            />
                          ) : null}
                        </span>
                        <code className="truncate">{piece}</code>
                      </li>
                    );
                  })}
                </ul>
              )}
            </section>
            {unread.length > 0 ? (
              <section className="card flex flex-col gap-2 p-4" data-testid="kit-theme-unread">
                <h3 className="eyebrow">{t("kit.theme.unread")}</h3>
                <p className="text-xs text-[var(--text-mut)]">{t("kit.theme.unreadHint")}</p>
                <ul className="flex flex-col gap-1">
                  {unread.map((path) => (
                    <li
                      key={path}
                      className="rounded-[var(--r-md)] bg-[var(--surface-inset)] p-1.5 text-xs"
                    >
                      <code className="truncate">{path}</code>
                    </li>
                  ))}
                </ul>
              </section>
            ) : null}
            {name in own ? (
              <section className="card flex flex-col gap-2 p-4">
                <h3 className="eyebrow">{t("kit.theme.ownImages")}</h3>
                <p className="text-xs text-[var(--text-mut)]">
                  {t(ownImages.length > 0 ? "kit.theme.ownImagesHint" : "kit.theme.noOwnImages", {
                    name,
                  })}
                </p>
                {ownImages.length > 0 ? (
                  <ul className="flex flex-col gap-1.5" data-testid="kit-theme-own-images">
                    {ownImages.map((image) => (
                      <li
                        key={image.id}
                        className="flex items-center gap-2 rounded-[var(--r-md)] bg-[var(--surface-inset)] p-1.5 text-xs"
                      >
                        <span className="flex h-9 w-14 shrink-0 items-center justify-center">
                          <AssetPreview
                            asset={image}
                            className="max-h-full max-w-full object-contain"
                          />
                        </span>
                        <code className="truncate">{image.id}</code>
                      </li>
                    ))}
                  </ul>
                ) : null}
              </section>
            ) : null}
            <section className="flex flex-col gap-2">
              <p className="text-[12px] text-[var(--text-mut)]">
                {t(name in own ? "kit.theme.filesOwn" : "kit.theme.files", { name })}
              </p>
              {onOpenKit && !(name in own) ? (
                <div>
                  <Button variant="outline" size="sm" onClick={onOpenKit}>
                    {t("kit.page.open")}
                  </Button>
                </div>
              ) : null}
              {name in own && (onOpenTheme || onExport) ? (
                <div className="flex flex-wrap gap-2">
                  {onOpenTheme ? (
                    <Button variant="outline" size="sm" onClick={onOpenTheme}>
                      {t("kit.theme.open")}
                    </Button>
                  ) : null}
                  {onExport ? (
                    <Button
                      variant="outline"
                      size="sm"
                      disabled={busy}
                      onClick={() => void exportIt()}
                    >
                      {t("kit.theme.export")}
                    </Button>
                  ) : null}
                </div>
              ) : null}
              {moves ? (
                <ThemeMoves
                  name={name}
                  inPlace={inPlace}
                  taken={taken}
                  onRename={onRename ? (target) => onRename(name, target) : undefined}
                  onDelete={onDelete ? () => onDelete(name) : undefined}
                />
              ) : null}
            </section>
          </div>
          <section className="card flex min-w-0 flex-1 flex-col gap-3 p-4">
            <h3 className="eyebrow">{t("kit.theme.compare")}</h3>
            <div className="flex flex-wrap justify-center gap-6 rounded-[var(--r-md)] bg-[var(--surface-inset)] p-4">
              <figure className="flex flex-col items-center gap-2" data-testid="kit-theme-before">
                <figcaption className="text-xs font-medium text-[var(--text-mut)]">
                  {t("kit.page.noTheme")}
                </figcaption>
                <KitTrialMenu kit={plain} />
              </figure>
              <figure className="flex flex-col items-center gap-2" data-testid="kit-theme-after">
                <figcaption className="text-xs font-medium text-[var(--text-mut)]">
                  {name}
                </figcaption>
                <KitTrialMenu kit={themed} />
              </figure>
            </div>
            <p className="text-[12px] text-[var(--text-mut)]">{t("kit.theme.putHint")}</p>
          </section>
        </div>
      )}
    </div>
  );
}
