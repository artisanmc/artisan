import { useTranslation } from "react-i18next";
import { type GuideName, type Rect, SLOT, imageGuides } from "./guideRules";

const box = (rect: Rect, scale: number) => ({
  left: rect.x * scale,
  top: rect.y * scale,
  width: rect.width * scale,
  height: rect.height * scale,
});

/** Lines every slot over an area, from its top left corner. */
const lines = (scale: number) => ({
  backgroundImage:
    "linear-gradient(to right, var(--brand) 0 1px, transparent 1px), linear-gradient(to bottom, var(--brand) 0 1px, transparent 1px)",
  backgroundSize: `${SLOT * scale}px ${SLOT * scale}px`,
});

/**
 * The guides of an image (`imageGuides`), drawn over it at `scale` and out of the pointer's
 * way: the slots, and for a window the player's inventory and the title's line. Nothing of it
 * is part of the image.
 */
export function ImageGuides({
  width,
  height,
  scale,
  shown,
}: {
  width: number;
  height: number;
  scale: number;
  shown: readonly GuideName[];
}) {
  const { t } = useTranslation();
  const guides = imageGuides(width, height);
  if (!guides || shown.length === 0) return null;
  const frame = "pointer-events-none absolute box-border";
  if (guides.kind === "area") {
    return shown.includes("slots") ? (
      <span
        aria-hidden
        data-testid="guide-slots"
        className={`${frame} inset-0 border-r border-b border-[var(--brand)]`}
        style={lines(scale)}
      />
    ) : null;
  }
  return (
    <>
      {shown.includes("slots") && (
        <span
          aria-hidden
          data-testid="guide-slots"
          className={`${frame} border-r border-b border-[var(--brand)]`}
          style={{ ...box(guides.slots, scale), ...lines(scale) }}
        />
      )}
      {shown.includes("inventory") &&
        guides.inventory.map((rect) => (
          <span
            key={rect.y}
            aria-hidden
            data-testid="guide-inventory"
            title={t("studio.guides.inventoryHint")}
            className={`${frame} border border-dashed border-[var(--warning)]`}
            style={{
              ...box(rect, scale),
              backgroundImage:
                "repeating-linear-gradient(135deg, var(--warning-soft) 0 4px, transparent 4px 12px)",
            }}
          />
        ))}
      {shown.includes("title") && (
        <span
          aria-hidden
          data-testid="guide-title"
          // A plain line and a hatch in a colour that stands out on a window's light grey.
          className={`${frame} border border-[var(--kind-trigger)]`}
          style={{
            ...box(guides.title, scale),
            backgroundImage:
              "repeating-linear-gradient(135deg, var(--kind-trigger-line) 0 4px, transparent 4px 12px)",
          }}
        />
      )}
    </>
  );
}
