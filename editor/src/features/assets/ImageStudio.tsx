import { Button } from "@/components/ui/button";
import { Tooltip } from "@/components/ui/tooltip";
import type { Asset } from "@/domain/asset";
import type { ProjectId } from "@/domain/types";
import { cx } from "@/lib/cx";
import { useProjectPrincipalId } from "@/lib/projectPrincipal";
import { useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import { create } from "zustand";
import { persist } from "zustand/middleware";
import { ComposedImageEditor } from "./ComposedImageEditor";
import { SaveAsDialog, type SaveAsServer } from "./SaveAsDialog";
import { SlicePanel } from "./SlicePanel";
import {
  StudioFrame,
  type StudioParts,
  StudioSection,
  type StudioTool,
  useStudioView,
} from "./StudioFrame";
import { type GuideName, guideNames, imageGuides } from "./guideRules";

/** The guides and the preview the atelier shows, kept between images and sessions. */
export const useStudioPrefs = create<{
  hidden: GuideName[];
  situation: boolean;
  toggleGuide: (guide: GuideName) => void;
  toggleSituation: () => void;
}>()(
  persist(
    (set) => ({
      hidden: [],
      situation: true,
      toggleGuide: (guide) =>
        set((s) => ({
          hidden: s.hidden.includes(guide)
            ? s.hidden.filter((g) => g !== guide)
            : [...s.hidden, guide],
        })),
      toggleSituation: () => set((s) => ({ situation: !s.situation })),
    }),
    { name: "artisan-image-studio", version: 1 },
  ),
);

/** The colour each guide is drawn in (`ImageGuides`): its switch wears it. */
const GUIDE_COLOUR: Record<GuideName, string> = {
  slots: "var(--brand)",
  inventory: "var(--warning)",
  title: "var(--kind-trigger)",
};

function Toggle({
  pressed,
  onClick,
  colour,
  children,
}: { pressed: boolean; onClick: () => void; colour?: string; children: string }) {
  return (
    <button
      type="button"
      aria-pressed={pressed}
      onClick={onClick}
      className={cx("chip text-[12px]", pressed && "is-active")}
    >
      {colour ? (
        <span
          aria-hidden
          className="mr-1.5 inline-block size-2 rounded-full"
          style={{ backgroundColor: colour }}
        />
      ) : null}
      {children}
    </button>
  );
}

/**
 * The atelier: an image edited on its own screen, in place of the library, laid out as a
 * drawing program (`StudioFrame`): the tools on the left, the image in the middle, and on the
 * right its layers, what the selected one and the tool in hand need, the guides of its size
 * (slots, and for a window the player's inventory and the title) and, for an image on slots,
 * the image as a player sees it in a menu. An image is one or several layers, a PNG being an
 * image of one: every image is edited by the same editor (`ComposedImageEditor`), which draws
 * on its layers, moves and repeats them, and saves them together.
 */
export function ImageStudio({
  projectId,
  asset,
  onClose,
  server,
}: {
  projectId: ProjectId;
  asset: Asset;
  onClose: () => void;
  /** The server the Project is on: the image can then be saved as, in another of its places. */
  server?: SaveAsServer;
}) {
  const { t } = useTranslation();
  const prefs = useStudioPrefs();
  const user = useProjectPrincipalId(projectId);
  const [tool, setTool] = useState<StudioTool>(asset.compose ? "move" : "pencil");
  const [savingAs, setSavingAs] = useState(false);
  // Another image opens fitted to the room it has.
  // biome-ignore lint/correctness/useExhaustiveDependencies: the image open, not the store's setter
  useEffect(() => {
    useStudioView.getState().setZoom(null);
  }, [asset.id]);
  const offered = guideNames(asset.width, asset.height);
  const shown = offered.filter((guide) => !prefs.hidden.includes(guide));
  const kind = imageGuides(asset.width, asset.height);
  // A window is the menu: only an image laid on slots is shown in one.
  const inMenu = kind?.kind !== "window" && asset.width > 0 && asset.height > 0;
  const situation = inMenu && prefs.situation;
  const what =
    kind?.kind === "window"
      ? t("studio.window", { count: kind.rows })
      : kind?.kind === "area"
        ? t("studio.area", { columns: kind.columns, rows: kind.rows })
        : t("studio.single");

  const frame = (parts: StudioParts) => (
    <StudioFrame
      back={t("studio.back")}
      onBack={onClose}
      title={asset.name}
      subtitle={`${what}${asset.width > 0 ? ` · ${asset.width} × ${asset.height} px` : ""}${
        asset.compose ? ` · ${t("studio.layers", { count: asset.compose.layers.length })}` : ""
      }`}
      parts={parts}
      guides={
        <>
          {inMenu ? <SlicePanel projectId={projectId} asset={asset} disabled={!user} /> : null}
          {offered.length > 0 || inMenu ? (
            <StudioSection title={t("studio.guides.label")}>
              <div className="flex flex-wrap items-center gap-1.5">
                {offered.map((guide) => (
                  <Toggle
                    key={guide}
                    pressed={shown.includes(guide)}
                    onClick={() => prefs.toggleGuide(guide)}
                    colour={GUIDE_COLOUR[guide]}
                  >
                    {t(`studio.guides.${guide}`)}
                  </Toggle>
                ))}
                {inMenu && (
                  <Toggle pressed={situation} onClick={prefs.toggleSituation}>
                    {t("studio.guides.situation")}
                  </Toggle>
                )}
              </div>
            </StudioSection>
          ) : null}
        </>
      }
    />
  );

  return (
    <ComposedImageEditor
      projectId={projectId}
      asset={asset}
      tool={tool}
      onTool={setTool}
      guides={shown}
      situation={situation}
      layout={frame}
      footer={(picture) =>
        server ? (
          <div data-testid="studio-save-as">
            <Tooltip content={t("saveAs.hint")} side="top">
              <Button variant="outline" size="sm" onClick={() => setSavingAs(true)}>
                {t("saveAs.button")}
              </Button>
            </Tooltip>
            {savingAs ? (
              <SaveAsDialog
                projectId={projectId}
                asset={asset}
                picture={picture}
                server={server}
                onClose={() => setSavingAs(false)}
              />
            ) : null}
          </div>
        ) : null
      }
    />
  );
}
