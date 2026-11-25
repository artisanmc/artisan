import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import type { Asset } from "@/domain/asset";
import { AssetPreview } from "./AssetPreview";
import { isKitBase, useKitAssets } from "./kitAssets";
import { cx } from "@/lib/cx";
import { KIT_PREFIX, KIT_SLOTS, type KitSlot, kitNameOf } from "@/lib/pack/kit";
import { themeNames } from "@/lib/pack/theme";
import { useKitStore } from "@/state/kitStore";
import { type ReactNode, useMemo, useState } from "react";
import { useTranslation } from "react-i18next";
import { KitTrialMenu } from "./KitTrialMenu";
import { KIT_FAMILIES, kitPiecesOf } from "./kitPieces";

/** The room a piece's picture has on its card, in pixels. */
const ROOM = { width: 120, height: 64 };
const MAX_SCALE = 3;

function Picture({ asset, width, height }: { asset?: Asset; width: number; height: number }) {
  const scale =
    width > 0 && height > 0
      ? Math.min(MAX_SCALE, Math.floor(Math.min(ROOM.width / width, ROOM.height / height)))
      : 0;
  return (
    <div className="flex items-center justify-center" style={{ height: ROOM.height }}>
      {asset ? (
        <AssetPreview
          asset={asset}
          lazy
          className="max-h-full max-w-full object-contain"
          style={scale >= 1 ? { width: width * scale, height: height * scale } : undefined}
        />
      ) : null}
    </div>
  );
}

/** A piece's card: a button when the piece can be opened, a plain card otherwise. */
function Card({
  testId,
  highlighted,
  onOpen,
  onHover,
  children,
}: {
  testId: string;
  highlighted?: boolean;
  onOpen?: () => void;
  onHover?: (over: boolean) => void;
  children: ReactNode;
}) {
  const className = cx(
    "card flex min-w-0 flex-col gap-1.5 p-2 text-left",
    highlighted && "border-[var(--accent)]",
    onOpen && "cursor-pointer hover:border-[var(--accent)]",
  );
  const hover = onHover
    ? { onMouseEnter: () => onHover(true), onMouseLeave: () => onHover(false) }
    : {};
  return onOpen ? (
    <button type="button" className={className} data-testid={testId} onClick={onOpen} {...hover}>
      {children}
    </button>
  ) : (
    <div className={className} data-testid={testId} {...hover}>
      {children}
    </div>
  );
}

/** How many menus name a common image, under its card. */
function Uses({ count }: { count: number }) {
  const { t } = useTranslation();
  return (
    <span className="text-[11px] text-[var(--text-faint)]" data-testid="kit-uses">
      {count > 0 ? t("kit.page.usedBy", { count }) : t("kit.page.unused")}
    </span>
  );
}

/**
 * The server's common images (`lib/pack/kit.ts`), a screen of the server: every piece of the base
 * by family with who drew it (Artisan, or this server), the images the server added, its themes,
 * and all the pieces set on one menu, as players see them. The page reads the published theme
 * `artisan`; a piece is redrawn in its Project, which a click on it opens (`onPiece`).
 */
export function KitPage({
  menusNaming,
  usesOf,
  onPiece,
  onOpenKit,
  onTheme,
}: {
  /** How many of the server's menus name a common image. */
  menusNaming: number;
  /** How many menus name the common image `name`; absent = not shown. */
  usesOf?: (name: string) => number;
  /** Opens the piece `id` in the atelier of the common images; absent on a server that has no theme `artisan`. */
  onPiece?: (id: string) => void;
  /** Opens the common images' Project on its images. */
  onOpenKit?: () => void;
  /** Opens the theme `name`. */
  onTheme?: (name: string) => void;
}) {
  const { t } = useTranslation();
  const read = useKitStore((s) => s.read);
  const theme = useKitStore((s) => s.theme);
  const kit = useKitAssets();
  const [over, setOver] = useState<string | null>(null);
  const themes = useMemo(
    () =>
      read
        ? themeNames(
            Object.keys(read.files),
            read.binaries.map((b) => b.path),
          )
        : [],
    [read],
  );
  const piece = (slot: KitSlot) => kit.find((a) => a.id === KIT_PREFIX + slot.id);
  const others = kit.filter((a) => !isKitBase(a));
  const redrawn = KIT_SLOTS.filter((slot) => !!piece(slot)?.contentHash).length;
  const open = read && onPiece ? onPiece : undefined;

  return (
    <div className="flex flex-col gap-4" data-testid="kit-page">
      <header className="flex flex-wrap items-start gap-3">
        <div className="flex min-w-0 flex-1 flex-col gap-1">
          <h2 className="text-lg font-semibold">{t("kit.page.title")}</h2>
          <p className="text-[13px] text-[var(--text-mut)]">{t("kit.page.intro")}</p>
          {!read ? (
            <p className="text-[13px] text-[var(--text-mut)]">{t("kit.page.none")}</p>
          ) : null}
        </div>
        {read && onOpenKit ? (
          <Button variant="outline" onClick={onOpenKit}>
            {t("kit.page.open")}
          </Button>
        ) : null}
      </header>

      <div className="flex flex-wrap items-center gap-1.5" data-testid="kit-themes">
        <span className="field-label mr-1">{t("kit.page.themes")}</span>
        <Badge variant={theme ? "sage" : "amber"}>
          {t(theme ? "kit.page.noTheme" : "kit.page.noThemeInPlace")}
        </Badge>
        {themes.map((name) =>
          onTheme ? (
            <button
              key={name}
              type="button"
              className={cx("chip text-[12px]", name === theme && "is-active")}
              onClick={() => onTheme(name)}
            >
              {name === theme ? t("kit.page.themeInPlace", { name }) : name}
            </button>
          ) : (
            <Badge key={name} variant={name === theme ? "amber" : "sage"}>
              {name === theme ? t("kit.page.themeInPlace", { name }) : name}
            </Badge>
          ),
        )}
        {themes.length === 0 ? (
          <span className="text-[12px] text-[var(--text-faint)]">{t("kit.page.noThemes")}</span>
        ) : null}
      </div>

      <div className="flex flex-col gap-5 xl:flex-row xl:items-start">
        <div className="flex min-w-0 flex-1 flex-col gap-4">
          {KIT_FAMILIES.map((family) => (
            <section key={family} className="flex flex-col gap-2">
              <h3 className="eyebrow">{t(`kit.page.family.${family}`)}</h3>
              <div className="grid grid-cols-[repeat(auto-fill,minmax(140px,1fr))] gap-2">
                {kitPiecesOf(family).map((slot) => {
                  const shown = piece(slot);
                  const mine = !!shown?.contentHash;
                  return (
                    <Card
                      key={slot.id}
                      testId={`kit-slot-${slot.id}`}
                      highlighted={over === slot.id}
                      onOpen={open ? () => open(slot.id) : undefined}
                      onHover={(inside) => setOver(inside ? slot.id : null)}
                    >
                      <Picture asset={shown} width={slot.width} height={slot.height} />
                      <span className="truncate text-xs font-medium" title={slot.id}>
                        {slot.id}
                      </span>
                      <span className="flex items-center justify-between gap-1 text-[11px] text-[var(--text-mut)]">
                        <span>
                          {slot.width} × {slot.height} px
                        </span>
                        <Badge variant={mine ? "amber" : "sage"}>
                          {t(mine ? "kit.page.redrawn" : "kit.page.shipped")}
                        </Badge>
                      </span>
                      {usesOf ? <Uses count={usesOf(slot.id)} /> : null}
                    </Card>
                  );
                })}
              </div>
            </section>
          ))}
          <section className="flex flex-col gap-2">
            <h3 className="eyebrow">{t("kit.page.others")}</h3>
            {others.length === 0 ? (
              <p className="text-xs text-[var(--text-mut)]">{t("kit.page.noOthers")}</p>
            ) : (
              <div className="grid grid-cols-[repeat(auto-fill,minmax(140px,1fr))] gap-2">
                {others.map((asset) => (
                  <Card key={asset.id} testId={`kit-other-${asset.id}`} onOpen={onOpenKit}>
                    <Picture asset={asset} width={asset.width} height={asset.height} />
                    <span
                      className="truncate text-xs font-medium"
                      title={kitNameOf(asset.id) ?? asset.name}
                    >
                      {kitNameOf(asset.id) ?? asset.name}
                    </span>
                    {asset.width > 0 ? (
                      <span className="text-[11px] text-[var(--text-mut)]">
                        {asset.width} × {asset.height} px
                      </span>
                    ) : null}
                    {usesOf ? <Uses count={usesOf(kitNameOf(asset.id) ?? asset.name)} /> : null}
                  </Card>
                ))}
              </div>
            )}
          </section>
        </div>

        <aside className="card flex shrink-0 flex-col gap-3 p-4 xl:sticky xl:top-0">
          <h3 className="eyebrow">{t("kit.page.inMenu")}</h3>
          <div className="flex justify-center rounded-[var(--r-md)] bg-[var(--surface-inset)] p-4">
            <KitTrialMenu kit={kit} over={over} onOver={setOver} onOpen={open} />
          </div>
          <p className="max-w-[384px] text-[12px] text-[var(--text-mut)]">
            {t(open ? "kit.page.inMenuHint" : "kit.page.inMenuHintNoKit")}
          </p>
          <div className="flex flex-wrap gap-1.5">
            <Badge variant="sage">
              {t("kit.page.redrawnCount", { count: redrawn, total: KIT_SLOTS.length })}
            </Badge>
            <Badge variant="sage">{t("kit.page.menusNaming", { count: menusNaming })}</Badge>
          </div>
        </aside>
      </div>
    </div>
  );
}
