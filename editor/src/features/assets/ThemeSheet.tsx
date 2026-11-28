import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import type { Asset } from "@/domain/asset";
import { cx } from "@/lib/cx";
import { KIT_PREFIX, kitNameOf } from "@/lib/pack/kit";
import { useMemo, useState } from "react";
import { useTranslation } from "react-i18next";
import { AssetPreview } from "./AssetPreview";

/**
 * The base's images without a theme and with it, one card an image. At first only what the
 * theme redraws: a pair of identical pictures says nothing. Every image is a click away, the
 * redrawn ones first, where a change of colour shows. A sheet, not a menu: a menu has fewer
 * slots than a base has pieces. `filter` narrows it by name.
 */
export function ThemeSheet({
  name,
  plain,
  themed,
  redrawn,
}: {
  /** The theme, written over its column. */
  name: string;
  /** The base's images with no theme, and in the theme as edited. */
  plain: readonly Asset[];
  themed: readonly Asset[];
  /** The names the theme holds an image of. */
  redrawn: ReadonlySet<string>;
}) {
  const { t } = useTranslation();
  const [filter, setFilter] = useState("");
  const [every, setEvery] = useState(false);
  const rows = useMemo(() => {
    const before = new Map(plain.map((asset) => [asset.id, asset]));
    return themed
      .filter((asset) => asset.id.startsWith(KIT_PREFIX) && asset.type !== "font")
      .map((asset) => {
        const piece = kitNameOf(asset.id) ?? asset.name;
        return { piece, after: asset, before: before.get(asset.id), redrawn: redrawn.has(piece) };
      })
      .sort(
        (a, b) => Number(b.redrawn) - Number(a.redrawn) || a.piece.localeCompare(b.piece, "en"),
      );
  }, [plain, themed, redrawn]);
  const wanted = filter.trim().toLowerCase();
  const listed = every ? rows : rows.filter((row) => row.redrawn);
  const shown = wanted ? listed.filter((row) => row.piece.toLowerCase().includes(wanted)) : listed;
  const picture = (asset: Asset | undefined) =>
    asset ? (
      <AssetPreview asset={asset} lazy className="max-h-full max-w-full object-contain" />
    ) : (
      <span className="text-[11px] text-[var(--text-faint)]">{t("kit.theme.sheet.none")}</span>
    );
  return (
    <div className="flex flex-col gap-3" data-testid="kit-theme-sheet">
      <div className="flex flex-wrap items-center gap-2">
        <Input
          className="h-8 max-w-xs"
          aria-label={t("kit.theme.sheet.filter")}
          placeholder={t("kit.theme.sheet.filter")}
          value={filter}
          onChange={(event) => setFilter(event.target.value)}
        />
        <button
          type="button"
          aria-pressed={every}
          className={cx("chip text-[12px]", every && "is-active")}
          onClick={() => setEvery((all) => !all)}
        >
          {every
            ? t("kit.theme.sheet.redrawnOnly")
            : t("kit.theme.sheet.all", { count: rows.length })}
        </button>
      </div>
      {shown.length === 0 ? (
        <p className="text-xs text-[var(--text-mut)]">
          {listed.length === 0 ? t("kit.theme.sheet.nothing") : t("kit.theme.sheet.empty")}
        </p>
      ) : (
        <ul className="grid grid-cols-[repeat(auto-fill,minmax(220px,1fr))] gap-2">
          {shown.map((row) => (
            <li
              key={row.piece}
              data-testid="kit-theme-sheet-row"
              className="flex flex-col gap-1.5 rounded-[var(--r-md)] bg-[var(--surface-inset)] p-2"
            >
              <div className="flex items-center gap-1.5 text-xs">
                <code className="min-w-0 flex-1 truncate">{row.piece}</code>
                {row.redrawn ? <Badge>{t("resources.mark.override")}</Badge> : null}
              </div>
              <div className="grid grid-cols-2 gap-2">
                {(
                  [
                    [t("kit.page.noTheme"), row.before],
                    [name, row.after],
                  ] as const
                ).map(([caption, asset], column) => (
                  <figure
                    // biome-ignore lint/suspicious/noArrayIndexKey: two fixed columns, without and with
                    key={column}
                    className="flex min-w-0 flex-col items-center gap-1"
                  >
                    <span className="checker flex h-20 w-full items-center justify-center rounded-[var(--r-sm)] p-1">
                      {picture(asset)}
                    </span>
                    <figcaption className="max-w-full truncate text-[11px] text-[var(--text-mut)]">
                      {caption}
                    </figcaption>
                  </figure>
                ))}
              </div>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
