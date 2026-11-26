import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { ResetButton } from "@/components/ui/reset-button";
import { KIT_FOLDER, KIT_PREFIX } from "@/lib/pack/kit";
import { KIT_RAMPS, rampPicked, withRamp } from "@/lib/pack/ramps";
import { themeColor } from "@/lib/pack/theme";
import { useKitStore } from "@/state/kitStore";
import { useMemo, useState } from "react";
import { useTranslation } from "react-i18next";
import { AssetPreview } from "./AssetPreview";
import { KitTrialMenu } from "./KitTrialMenu";
import { ThemeMoves } from "./ThemeMoves";
import { publishedKitTheme, useKitAssetsIn } from "./kitAssets";
import { serverThemeNames } from "./kitTheme";

const hex = (color: number) => `#${color.toString(16).padStart(6, "0")}`;

function Swatch({ color }: { color: number }) {
  return (
    <span
      aria-hidden
      className="h-7 w-7 shrink-0 rounded-[var(--r-sm)] border border-[var(--border)]"
      style={{ background: hex(color) }}
    />
  );
}

const sameTable = (a: ReadonlyMap<number, number>, b: ReadonlyMap<number, number>) =>
  a.size === b.size && [...a].every(([from, to]) => b.get(from) === to);

/**
 * One theme of the server's kit (`lib/pack/theme.ts`), read from the published kit module: the
 * colours it replaces, the pieces it redraws, and the same menu without it and with it. A theme
 * is put in place from here (`onPutInPlace`: on top of the server's `resource-pack.themes`,
 * then its pack rebuilt), and taken off the same way.
 *
 * A theme of its own folder has its colours picked here (`onColors`): one colour per ramp of
 * the base (`lib/pack/ramps.ts`), the shades computed, the menu shown with them before they
 * are written. Such a theme is renamed and deleted from here too (`onRename`, `onDelete`),
 * when the server moves a theme's folder, and exported as an archive (`onExport`).
 */
export function KitThemePage({
  name,
  onBack,
  backLabel,
  onPutInPlace,
  onOpenKit,
  onOpenTheme,
  onColors,
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
  /** Writes the table `colors` in the file of the theme `name`, a theme of its own folder. */
  onColors?: (name: string, colors: ReadonlyMap<number, number>) => Promise<void>;
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
  // The table as it is being picked; `null`: the theme's own, as published.
  const [picked, setPicked] = useState<ReadonlyMap<number, number> | null>(null);
  const changed = picked !== null && !!theme && !sameTable(picked, theme.colors);
  const table = changed ? picked : (theme?.colors ?? null);
  const plain = useKitAssetsIn(null);
  const themed = useKitAssetsIn(name, changed ? picked : null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const picks = !!onColors && name in own;
  const moves = own[name]?.canMove === true;
  const taken = useMemo(() => serverThemeNames(read, own), [read, own]);

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

  const save = async () => {
    if (busy || !onColors || !changed) return;
    setBusy(true);
    setError(null);
    try {
      await onColors(name, picked);
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

  const colors = table ? [...table] : [];
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
          {error === "conflict"
            ? t("kit.theme.ramps.conflict")
            : error.startsWith("export:")
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
            {picks && table ? (
              <section className="card flex flex-col gap-2 p-4" data-testid="kit-theme-ramps">
                <h3 className="eyebrow">{t("kit.theme.ramps.title")}</h3>
                <p className="text-xs text-[var(--text-mut)]">{t("kit.theme.ramps.hint")}</p>
                <ul className="flex flex-col gap-1.5">
                  {KIT_RAMPS.map((ramp) => {
                    const now = rampPicked(ramp, table);
                    const label = t(`kit.theme.ramps.${ramp.id}`, { defaultValue: ramp.id });
                    return (
                      <li
                        key={ramp.id}
                        className="flex items-center gap-2 rounded-[var(--r-md)] bg-[var(--surface-inset)] p-1.5 text-xs"
                      >
                        <Swatch color={ramp.main} />
                        <span className="min-w-0 flex-1 truncate">{label}</span>
                        <input
                          type="color"
                          aria-label={t("kit.theme.ramps.pick", { ramp: label })}
                          value={hex(now)}
                          disabled={busy}
                          onChange={(event) => {
                            const next = themeColor(event.target.value);
                            if (next !== null) setPicked(withRamp(table, ramp, next));
                          }}
                          className="size-8 shrink-0 cursor-pointer rounded border border-[var(--border)] bg-transparent p-0"
                        />
                        <ResetButton
                          modified={now !== ramp.main}
                          onReset={() => setPicked(withRamp(table, ramp, ramp.main))}
                          label={t("kit.theme.ramps.reset")}
                        />
                      </li>
                    );
                  })}
                </ul>
                {changed ? (
                  <>
                    <div className="flex gap-2">
                      <Button size="sm" disabled={busy} onClick={() => void save()}>
                        {t("kit.theme.ramps.save")}
                      </Button>
                      <Button
                        size="sm"
                        variant="ghost"
                        disabled={busy}
                        onClick={() => setPicked(null)}
                      >
                        {t("kit.theme.ramps.discard")}
                      </Button>
                    </div>
                    <p className="text-[12px] text-[var(--text-mut)]">
                      {t(inPlace ? "kit.theme.ramps.saveInPlace" : "kit.theme.ramps.saveHint")}
                    </p>
                  </>
                ) : null}
              </section>
            ) : null}
            <section className="card flex flex-col gap-2 p-4">
              <h3 className="eyebrow">{t("kit.theme.colors")}</h3>
              {colors.length > 0 ? (
                <p className="text-xs text-[var(--text-mut)]" data-testid="kit-theme-scope">
                  {theme.scope === null
                    ? t("kit.theme.scopeAll")
                    : theme.scope === KIT_FOLDER
                      ? t("kit.theme.scopeCommon")
                      : t("kit.theme.scopeModule", { module: theme.scope })}
                </p>
              ) : null}
              {colors.length === 0 ? (
                <p className="text-xs text-[var(--text-mut)]">{t("kit.theme.noColors")}</p>
              ) : (
                <ul className="flex flex-col gap-1.5" data-testid="kit-theme-colors">
                  {colors.map(([from, to]) => (
                    <li
                      key={from}
                      className="flex items-center gap-2 rounded-[var(--r-md)] bg-[var(--surface-inset)] p-1.5 text-xs"
                    >
                      <Swatch color={from} />
                      <code>{hex(from)}</code>
                      <span className="text-[var(--text-mut)]">{t("kit.theme.becomes")}</span>
                      <Swatch color={to} />
                      <code>{hex(to)}</code>
                    </li>
                  ))}
                </ul>
              )}
            </section>
            <section className="card flex flex-col gap-2 p-4">
              <h3 className="eyebrow">{t("kit.theme.drawings")}</h3>
              {theme.drawings.length === 0 ? (
                theme.moduleDrawings.length === 0 ? (
                  <p className="text-xs text-[var(--text-mut)]">{t("kit.theme.noDrawings")}</p>
                ) : null
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
              {theme.moduleDrawings.length > 0 ? (
                <>
                  <h4 className="field-label">{t("kit.theme.moduleDrawings")}</h4>
                  <ul className="flex flex-col gap-1" data-testid="kit-theme-module-drawings">
                    {theme.moduleDrawings.map((key) => (
                      <li
                        key={key}
                        className="rounded-[var(--r-md)] bg-[var(--surface-inset)] p-1.5 text-xs"
                      >
                        <code className="truncate">{key}</code>
                      </li>
                    ))}
                  </ul>
                </>
              ) : null}
            </section>
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
                  {changed ? t("kit.theme.ramps.trying", { name }) : name}
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
