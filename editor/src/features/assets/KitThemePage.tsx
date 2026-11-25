import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { KIT_PREFIX } from "@/lib/pack/kit";
import { useKitStore } from "@/state/kitStore";
import { useMemo, useState } from "react";
import { useTranslation } from "react-i18next";
import { AssetPreview } from "./AssetPreview";
import { KitTrialMenu } from "./KitTrialMenu";
import { publishedKitTheme, useKitAssetsIn } from "./kitAssets";

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

/**
 * One theme of the server's kit (`lib/pack/theme.ts`), read from the published kit module: the
 * colours it replaces, the pieces it redraws, and the same menu without it and with it. A theme
 * is put in place from here (`onPutInPlace`: on top of the server's `resource-pack.themes`,
 * then its pack rebuilt), and taken off the same way.
 */
export function KitThemePage({
  name,
  onBack,
  onPutInPlace,
  onOpenKit,
}: {
  name: string;
  onBack: () => void;
  /** Puts the theme `name` in place on the server, above the ones that are (`put`), or takes it off. */
  onPutInPlace?: (name: string, put: boolean) => Promise<void>;
  /** Opens the common images' Project, where the files of a theme it still keeps are. */
  onOpenKit?: () => void;
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

  const colors = theme ? [...theme.colors] : [];
  return (
    <div className="flex flex-col gap-4" data-testid="kit-theme-page">
      <header className="flex flex-wrap items-center gap-3">
        <Button variant="outline" onClick={onBack}>
          {t("kit.theme.back")}
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
          {t("kit.theme.failed", { detail: error })}
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
              <h3 className="eyebrow">{t("kit.theme.colors")}</h3>
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
