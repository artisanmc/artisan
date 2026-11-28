import { resolveDisplayRef } from "@/domain/capturedItems";
import type { CapturedItem, Project } from "@/domain/types";
import { useTextureUrl } from "@/features/canvas/textureStore";
import { useHeadPreviewUrl } from "@/features/canvas/useHeadPreviewUrl";

/** One captured item's picture (its material or head, enchanted mark included). */
export function CapturedItemPicture({ project, item }: { project: Project; item: CapturedItem }) {
  const display = resolveDisplayRef(project, `item:${item.id}`);
  const material = useTextureUrl(display.material);
  const url = useHeadPreviewUrl(display.head) ?? material;
  return (
    <span className="relative flex size-7 shrink-0 items-center justify-center">
      {url ? (
        <img
          src={url}
          alt=""
          draggable={false}
          className="size-full object-contain"
          style={{ imageRendering: "pixelated" }}
        />
      ) : (
        <span className="text-[9px] text-[var(--text-mut)]">
          {(display.material ?? "?").slice(0, 5)}
        </span>
      )}
      {display.enchanted && (
        <span aria-hidden className="absolute top-0 left-0 text-[10px] text-[var(--brand)]">
          ✦
        </span>
      )}
    </span>
  );
}
