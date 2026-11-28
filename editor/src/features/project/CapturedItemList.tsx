import { resolveDisplayRef } from "@/domain/capturedItems";
import type { CapturedItem, Project } from "@/domain/types";
import { useTextureUrl } from "@/features/canvas/textureStore";
import { useHeadPreviewUrl } from "@/features/canvas/useHeadPreviewUrl";

/**
 * The module's captured items on its home: each one's picture and name, to read at a glance
 * (the Captured items page edits them). Not draggable here: no board to drop on.
 */
export function CapturedItemList({
  project,
  items,
}: {
  project: Project;
  items: readonly CapturedItem[];
}) {
  return (
    <ul
      data-testid="module-home-captured-list"
      className="grid grid-cols-[repeat(auto-fill,minmax(9rem,1fr))] gap-1.5"
    >
      {items.map((item) => (
        <li key={item.id}>
          <CapturedItemRow project={project} item={item} />
        </li>
      ))}
    </ul>
  );
}

function CapturedItemRow({ project, item }: { project: Project; item: CapturedItem }) {
  const display = resolveDisplayRef(project, `item:${item.id}`);
  const material = useTextureUrl(display.material);
  const url = useHeadPreviewUrl(display.head) ?? material;
  return (
    <span
      title={item.name}
      className="flex items-center gap-2 rounded-[var(--r-md)] border border-[var(--border-soft)] bg-[var(--surface-inset)] px-2 py-1.5"
    >
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
      <span className="min-w-0 flex-1 truncate text-[12.5px]">{item.name}</span>
    </span>
  );
}
