import { Input } from "@/components/ui/input";
import type { Element, MenuId, PackId } from "@/domain/types";
import { itemTextureUrl } from "@/features/canvas/itemTextures";
import { MiniMessageInline } from "@/lib/MiniMessageInline";
import { formatPositions, parsePositions } from "@/lib/positions";
import { useAccountStore } from "@/state/accountStore";
import { useState } from "react";
import { PropertyField } from "./PropertyField";

interface ElementPropertiesProps {
  packId: PackId;
  menuId: MenuId;
  element: Element;
}

const looksLikeMiniMessage = (s: string): boolean => s.includes("<");

export function ElementProperties({ packId, menuId, element }: ElementPropertiesProps) {
  const setAppearanceField = useAccountStore((s) => s.setAppearanceField);
  const setAppearanceLore = useAccountStore((s) => s.setAppearanceLore);
  const setElementPositions = useAccountStore((s) => s.setElementPositions);
  const appearance = element.appearances[0];
  const material = appearance?.material ?? "";
  const title = appearance?.title ?? "";
  const count = appearance?.count ?? 1;
  const loreText = (appearance?.lore ?? []).join("\n");
  const textureUrl = itemTextureUrl(material);
  const [positionsDraft, setPositionsDraft] = useState(element.positions);
  // Keep the draft in sync if the element is mutated outside this pane (e.g.
  // a slot is dropped/cleared elsewhere); reset on element id change.
  if (
    element.positions !== formatPositions(parsePositions(positionsDraft)) &&
    element.positions !== positionsDraft
  ) {
    // Don't fight active typing — only reset when the parsed canonical drifts.
  }
  const commitPositions = () => {
    const canonical = formatPositions(parsePositions(positionsDraft));
    if (canonical !== element.positions) {
      setElementPositions({ packId, menuId, elementId: element.id, positions: canonical });
    }
    setPositionsDraft(canonical);
  };
  const positionsCount = parsePositions(element.positions).length;

  return (
    <div className="flex flex-col gap-3">
      <div className="flex items-center gap-2 rounded border border-zinc-800 bg-zinc-900 p-2">
        <div className="flex h-12 w-12 items-center justify-center rounded border border-zinc-800 bg-[var(--color-bg)]">
          {textureUrl ? (
            <img
              src={textureUrl}
              alt={material}
              draggable={false}
              className="h-3/4 w-3/4 object-contain"
              style={{ imageRendering: "pixelated" }}
            />
          ) : (
            <span className="text-[10px] text-zinc-500">{material.slice(0, 4) || "—"}</span>
          )}
        </div>
        <div className="min-w-0 flex-1">
          <div className="font-mono text-xs text-zinc-300">{material || "(empty)"}</div>
          <div className="text-[10px] text-zinc-500">
            {positionsCount} slot{positionsCount > 1 ? "s" : ""} · element {element.id}
          </div>
        </div>
      </div>

      <div>
        <div className="mb-1 text-[10px] uppercase text-zinc-500">positions</div>
        <Input
          value={positionsDraft}
          placeholder="0-8,17,26"
          onChange={(e) => setPositionsDraft(e.target.value)}
          onBlur={commitPositions}
          onKeyDown={(e) => {
            if (e.key === "Enter") {
              commitPositions();
              e.currentTarget.blur();
            }
          }}
        />
        <div className="mt-1 text-[10px] text-zinc-500">
          comma-separated indices and ranges, e.g. <span className="font-mono">0-8,17,26</span>
        </div>
      </div>

      <div>
        <PropertyField
          label="title"
          value={title}
          placeholder="(none)"
          onChange={(v) =>
            setAppearanceField({ packId, menuId, elementId: element.id, field: "title", value: v })
          }
        />
        {looksLikeMiniMessage(title) && (
          <div className="mt-1 rounded border border-zinc-800 bg-[var(--color-bg)] px-2 py-1">
            <span className="mr-2 text-[9px] uppercase text-zinc-600">preview</span>
            <MiniMessageInline source={title} className="font-mono text-xs" />
          </div>
        )}
      </div>

      <div>
        <div className="mb-1 text-[10px] uppercase text-zinc-500">count</div>
        <Input
          type="number"
          min={1}
          max={64}
          value={count}
          onChange={(e) => {
            const n = Number(e.target.value);
            if (!Number.isNaN(n)) {
              setAppearanceField({
                packId,
                menuId,
                elementId: element.id,
                field: "count",
                value: n,
              });
            }
          }}
        />
      </div>

      <div>
        <div className="mb-1 text-[10px] uppercase text-zinc-500">lore</div>
        <textarea
          className="w-full rounded border border-zinc-800 bg-zinc-900 p-2 font-mono text-xs"
          rows={4}
          placeholder="One line per lore entry."
          value={loreText}
          onChange={(e) => {
            const lines = e.target.value.split("\n").filter(
              (_, i, arr) =>
                // Trim trailing empty line so the textarea doesn't bake an empty entry
                i < arr.length - 1 || arr[i] !== "",
            );
            setAppearanceLore({ packId, menuId, elementId: element.id, lines });
          }}
        />
        {appearance?.lore && appearance.lore.length > 0 && (
          <div className="mt-1 flex flex-col gap-0.5 rounded border border-zinc-800 bg-[var(--color-bg)] px-2 py-1">
            <span className="text-[9px] uppercase text-zinc-600">preview</span>
            {appearance.lore.map((line, i) => (
              <MiniMessageInline
                // biome-ignore lint/suspicious/noArrayIndexKey: lines are stable per render
                key={i}
                source={line}
                className="font-mono text-xs"
              />
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
