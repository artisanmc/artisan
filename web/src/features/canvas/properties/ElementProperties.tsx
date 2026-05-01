import { Input } from "@/components/ui/input";
import type { Action, Appearance, Element, MenuId, PackId } from "@/domain/types";
import { itemTextureUrl } from "@/features/canvas/itemTextures";
import { MiniMessageInline } from "@/lib/MiniMessageInline";
import { formatPositions, parsePositions } from "@/lib/positions";
import { useAccountStore } from "@/state/accountStore";
import { type FlowSubSelection, useFlowSelectionStore } from "@/state/flowSelectionStore";
import { useSelectionStore } from "@/state/selectionStore";
import { useEffect, useState } from "react";
import { ActionEditor } from "./ActionEditor";
import { PropertyField } from "./PropertyField";

interface ElementPropertiesProps {
  packId: PackId;
  menuId: MenuId;
  element: Element;
}

const looksLikeMiniMessage = (s: string): boolean => s.includes("<");

/**
 * Identity card + positions input — visible regardless of which sub-selection
 * is active. Below it the pane swaps between an appearance editor (default
 * or any state focused in the flow canvas) and an action editor.
 */
export function ElementProperties({ packId, menuId, element }: ElementPropertiesProps) {
  const sub = useFlowSelectionStore((s) => s.sub);
  // commandAction sub-selections never reach this component (top selection is
  // a command in that case), but the type allows it so we narrow defensively.
  const stateIndex = sub && (sub.kind === "state" || sub.kind === "action") ? sub.stateIndex : 0;
  const appearance = element.appearances[stateIndex] ?? element.appearances[0];

  return (
    <div className="flex flex-col gap-3">
      <ElementHeader packId={packId} element={element} appearance={appearance} />
      <PositionsField packId={packId} menuId={menuId} element={element} />
      {sub?.kind === "action" ? (
        <ActionSubEditor packId={packId} menuId={menuId} element={element} sub={sub} />
      ) : (
        <AppearanceFields
          packId={packId}
          menuId={menuId}
          element={element}
          stateIndex={stateIndex}
          appearance={appearance}
        />
      )}
    </div>
  );
}

function ElementHeader({
  packId: _packId,
  element,
  appearance,
}: {
  packId: PackId;
  element: Element;
  appearance: Appearance | undefined;
}) {
  const focusedSlot = useSelectionStore((s) => s.focusedSlot);
  const positionsCount = parsePositions(element.positions).length;
  const isMultiPos = positionsCount > 1;
  const material = appearance?.material ?? "";
  const textureUrl = itemTextureUrl(material);
  const modeLabel = !isMultiPos
    ? null
    : focusedSlot != null
      ? `slot ${focusedSlot} · click again to widen`
      : "whole button · click any slot to focus it";
  return (
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
        {modeLabel ? (
          <div
            className={`text-[10px] ${focusedSlot != null ? "text-emerald-400" : "text-blue-400"}`}
          >
            {modeLabel}
          </div>
        ) : null}
      </div>
    </div>
  );
}

function PositionsField({
  packId,
  menuId,
  element,
}: {
  packId: PackId;
  menuId: MenuId;
  element: Element;
}) {
  const setElementPositions = useAccountStore((s) => s.setElementPositions);
  const [positionsDraft, setPositionsDraft] = useState(element.positions);
  // biome-ignore lint/correctness/useExhaustiveDependencies: element.id forces draft reset on element switch
  useEffect(() => {
    setPositionsDraft(element.positions);
  }, [element.id, element.positions]);
  const commitPositions = () => {
    const canonical = formatPositions(parsePositions(positionsDraft));
    if (canonical !== element.positions) {
      setElementPositions({ packId, menuId, elementId: element.id, positions: canonical });
    }
    setPositionsDraft(canonical);
  };
  return (
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
  );
}

function AppearanceFields({
  packId,
  menuId,
  element,
  stateIndex,
  appearance,
}: {
  packId: PackId;
  menuId: MenuId;
  element: Element;
  stateIndex: number;
  appearance: Appearance | undefined;
}) {
  const setAppearanceField = useAccountStore((s) => s.setAppearanceField);
  const setAppearanceLore = useAccountStore((s) => s.setAppearanceLore);
  const title = appearance?.title ?? "";
  const count = appearance?.count ?? 1;
  const loreText = (appearance?.lore ?? []).join("\n");

  return (
    <>
      {stateIndex > 0 ? (
        <div className="rounded border border-emerald-500/30 bg-emerald-500/10 px-2 py-1 text-[10px] text-emerald-300">
          editing state {stateIndex}
        </div>
      ) : null}
      <div>
        <PropertyField
          label="title"
          value={title}
          placeholder="(none)"
          onChange={(v) =>
            setAppearanceField({
              packId,
              menuId,
              elementId: element.id,
              appearanceIndex: stateIndex,
              field: "title",
              value: v,
            })
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
                appearanceIndex: stateIndex,
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
            setAppearanceLore({
              packId,
              menuId,
              elementId: element.id,
              appearanceIndex: stateIndex,
              lines,
            });
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
    </>
  );
}

function ActionSubEditor({
  packId,
  menuId,
  element,
  sub,
}: {
  packId: PackId;
  menuId: MenuId;
  element: Element;
  sub: Extract<FlowSubSelection, { kind: "action" }>;
}) {
  const setElementAction = useAccountStore((s) => s.setElementAction);
  const appearance = element.appearances[sub.stateIndex];
  const handler = appearance?.click?.[sub.clickType];
  const list = sub.fallback ? handler?.fallback : handler?.actions;
  const action = list?.[sub.actionIndex];
  if (!action) {
    return (
      <div className="rounded border border-zinc-800 border-dashed bg-zinc-900/50 px-2 py-3 text-[11px] text-zinc-500">
        Action no longer exists. Pick another in the flow canvas.
      </div>
    );
  }
  const onChange = (next: Action) =>
    setElementAction({
      packId,
      menuId,
      elementId: element.id,
      appearanceIndex: sub.stateIndex,
      clickType: sub.clickType,
      fallback: sub.fallback,
      actionIndex: sub.actionIndex,
      action: next,
    });
  return (
    <div className="flex flex-col gap-2 rounded border border-zinc-800 bg-zinc-900/40 p-2">
      <div className="flex items-center gap-2 text-[10px] text-zinc-500">
        <span className="rounded bg-zinc-800 px-1.5 py-0.5 font-mono uppercase tracking-wide text-zinc-300">
          {action.type}
        </span>
        <span>
          {sub.clickType.replace("_", "+")}
          {sub.fallback ? " · on failure" : ""}
        </span>
      </div>
      <ActionEditor packId={packId} action={action} onChange={onChange} />
    </div>
  );
}
