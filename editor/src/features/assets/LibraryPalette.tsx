import { Collapsible } from "@/components/ui/collapsible";
import { KIT_PREFIX } from "@/lib/pack/kit";
import { DEFAULT_PALETTE, PALETTE_FILE, paletteOf } from "@/lib/pack/palette";
import { useKitStore } from "@/state/kitStore";
import { useMemo } from "react";
import { useTranslation } from "react-i18next";
import { AssetPreview } from "./AssetPreview";
import { ThemePalette, paletteFile, useThemePalette } from "./ThemePalette";
import { useKitAssetsIn } from "./kitAssets";

/** The base's buttons that take a palette colour, by the name they take. */
const TINTED = ["neutral", "primary", "success", "warning"].map(
  (name) => `${KIT_PREFIX}button.${name}.3x1`,
);
const NO_PALETTE = paletteOf([]);

function Colours({ projectId }: { projectId: string }) {
  const published = useKitStore((s) =>
    s.read?.projectId === projectId ? s.read.files[PALETTE_FILE] : undefined,
  );
  const state = useThemePalette(projectId, published);
  // The base's coloured buttons in the colours as picked, in no theme: seen before a deploy.
  const edited = useMemo(
    () => paletteOf([paletteFile(state.colours) ?? undefined]),
    [state.colours],
  );
  const kit = useKitAssetsIn(null, edited);
  const buttons = TINTED.flatMap((id) => kit.find((asset) => asset.id === id) ?? []);
  return (
    <ThemePalette state={state} below={NO_PALETTE} place="library">
      {buttons.length > 0 ? (
        <div
          className="flex flex-wrap gap-2 rounded-[var(--r-md)] bg-[var(--surface-inset)] p-2"
          data-testid="library-palette-buttons"
        >
          {buttons.map((button) => (
            <span key={button.id} className="flex h-9 w-[108px] items-center justify-center">
              <AssetPreview asset={button} className="max-h-full max-w-full object-contain" />
            </span>
          ))}
        </div>
      ) : null}
    </ThemePalette>
  );
}

/**
 * The server's palette (`lib/pack/palette.ts`), edited in the library's Project: the colours
 * its `palette.yml` gives the names a tint writes, for every module, under the themes in
 * place. Folded until asked for; written to the player's draft of the library like a theme's
 * on its page (`ThemePalette`).
 */
export function LibraryPalette({ projectId }: { projectId: string }) {
  const { t } = useTranslation();
  const published = useKitStore((s) =>
    s.read?.projectId === projectId ? s.read.files[PALETTE_FILE] : undefined,
  );
  const shown = useMemo(() => paletteOf([published]), [published]);
  return (
    <Collapsible
      className="shrink-0 px-3 pt-2"
      data-testid="library-palette"
      title={t("kit.theme.palette.libraryTitle")}
      meta={
        <span className="flex gap-1" aria-hidden>
          {Object.keys(DEFAULT_PALETTE).map((name) => (
            <span
              key={name}
              className="size-3 rounded-full border border-[var(--border)]"
              style={{ background: shown(name) }}
            />
          ))}
        </span>
      }
    >
      <div className="max-w-md pb-2">
        <Colours projectId={projectId} />
      </div>
    </Collapsible>
  );
}
