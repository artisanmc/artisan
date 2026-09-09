import { resolveDisplayRef } from "@/domain/capturedItems";
import { newCapturedItemId } from "@/domain/ids";
import type { CapturedItem, ProjectId } from "@/domain/types";
import { PlayerNameInput } from "@/components/PlayerNameInput";
import { type InventorySlotPayload, fetchPlayerInventory } from "@/lib/api/playerInventory";
import { useAccountStore } from "@/state/accountStore";
import { useNetworksStore } from "@/state/networksStore";
import { useServersStore } from "@/state/serversStore";
import { useUiStore } from "@/state/uiStore";
import { useDraggable } from "@dnd-kit/core";
import { useState } from "react";
import { useTranslation } from "react-i18next";
import { toast } from "sonner";
import { LIBRARY_DRAG_PREFIX } from "./Library";
import { headPreviewUrl } from "./headTexture";
import { useHeadPreviewUrl } from "./useHeadPreviewUrl";
import { useTextureUrl } from "./textureStore";

/**
 * "Items capturés" section of the Library tab — the universal capture flow
 * (ADR captured-items-and-module-field-kit). Two halves:
 *  - the project's captured items as draggable tiles (`item:<id>` material
 *    refs — same drag/arm gesture as vanilla Library items, zero new drop code);
 *  - the inventory mirror: fetch an online player's inventory from the live
 *    server and click a slot to capture its exact stack into the project.
 */
export function CapturedItemsSection({
  projectId,
  onPick,
}: {
  projectId: ProjectId;
  /** Picker mode: clicking a captured tile (or capturing from the mirror)
   *  calls back with the `item:<id>` ref instead of arming for the canvas. */
  onPick?: (ref: string) => void;
}) {
  const { t } = useTranslation();
  const project = useAccountStore((s) => s.account.projects.find((p) => p.id === projectId));
  const addCapturedItem = useAccountStore((s) => s.addCapturedItem);
  const removeCapturedItem = useAccountStore((s) => s.removeCapturedItem);
  const networkId = useNetworksStore((s) => s.activeId);
  const serverId = useServersStore((s) => s.activeServerId);

  const [player, setPlayer] = useState("");
  const [state, setState] = useState<
    | { kind: "idle" }
    | { kind: "loading" }
    | { kind: "done"; slots: InventorySlotPayload[] }
    | { kind: "error"; code: string }
  >({ kind: "idle" });

  if (!project) return null;
  const captured = project.capturedItems ?? [];

  const load = async () => {
    if (!networkId || !serverId || !player.trim()) return;
    setState({ kind: "loading" });
    const res = await fetchPlayerInventory(networkId, serverId, player.trim());
    setState(res.ok ? { kind: "done", slots: res.slots } : { kind: "error", code: res.error });
  };

  const capture = (slot: InventorySlotPayload) => {
    const item: CapturedItem = {
      id: newCapturedItemId(),
      name: slot.display.name ?? slot.display.material ?? "item",
      stackYaml: slot.stack_yaml,
      display: {
        ...(slot.display.material ? { material: slot.display.material } : {}),
        ...(slot.display.head_texture ? { headTexture: slot.display.head_texture } : {}),
        ...(slot.display.enchanted ? { enchanted: true } : {}),
        ...(slot.display.count ? { count: slot.display.count } : {}),
        ...(slot.display.name ? { name: slot.display.name } : {}),
      },
    };
    addCapturedItem({ projectId, item });
    toast.success(t("capturedItems.capturedToast", { name: item.name }));
    onPick?.(`item:${item.id}`);
  };

  return (
    <div className="flex flex-col gap-2" data-testid="captured-items-section">
      <div className="eyebrow">{t("capturedItems.sectionTitle")}</div>
      {captured.length > 0 ? (
        <div className="flex flex-wrap gap-1.5">
          {captured.map((ci) => (
            <CapturedTile
              key={ci.id}
              projectId={projectId}
              item={ci}
              onPick={onPick}
              onRemove={() => removeCapturedItem({ projectId, itemId: ci.id })}
            />
          ))}
        </div>
      ) : (
        <p className="text-[10px] text-[var(--text-faint)]">{t("capturedItems.emptyHint")}</p>
      )}

      {/* Inventory mirror */}
      <div className="flex items-center gap-1.5">
        <PlayerNameInput
          value={player}
          onChange={setPlayer}
          onCommit={() => void load()}
          placeholder={t("capturedItems.playerPlaceholder")}
          className="h-7 w-36 px-2 py-0 text-xs"
        />
        <button
          type="button"
          data-testid="load-inventory"
          disabled={state.kind === "loading" || !player.trim()}
          onClick={() => void load()}
          className="rounded border border-[var(--brand)]/60 bg-[var(--brand-soft)] px-2 py-1 text-[10px] text-[var(--brand)] hover:bg-[var(--brand)]/20 disabled:opacity-50"
        >
          {state.kind === "loading" ? t("capturedItems.loading") : t("capturedItems.load")}
        </button>
      </div>
      {state.kind === "error" ? (
        <div className="rounded border border-[var(--warning)]/50 bg-[var(--warning-soft)] px-2 py-1 text-[10px] text-[var(--warning)]">
          {t(`capturedItems.err_${state.code}`, t("capturedItems.err_fetch_error"))}
        </div>
      ) : null}
      {state.kind === "done" ? (
        state.slots.length === 0 ? (
          <p className="text-[10px] text-[var(--text-faint)]">
            {t("capturedItems.inventoryEmpty")}
          </p>
        ) : (
          <>
            <p className="text-[10px] text-[var(--text-faint)]">{t("capturedItems.captureHint")}</p>
            <div className="flex flex-wrap gap-1.5">
              {state.slots.map((slot) => (
                <InventoryTile key={slot.slot} slot={slot} onCapture={() => capture(slot)} />
              ))}
            </div>
          </>
        )
      ) : null}
    </div>
  );
}

/** A captured item tile — draggable/armable exactly like a Library material
 *  (or a plain pick button in picker mode). */
function CapturedTile({
  projectId,
  item,
  onPick,
  onRemove,
}: {
  projectId: ProjectId;
  item: CapturedItem;
  onPick?: (ref: string) => void;
  onRemove: () => void;
}) {
  const project = useAccountStore((s) => s.account.projects.find((p) => p.id === projectId));
  const setArmedMaterial = useUiStore((s) => s.setArmedMaterial);
  const armed = useUiStore((s) => s.armedMaterial === `item:${item.id}`);
  const ref = `item:${item.id}`;
  const display = project ? resolveDisplayRef(project, ref) : { material: ref };
  const materialUrl = useTextureUrl(display.material);
  const textureUrl = useHeadPreviewUrl(display.head) ?? materialUrl;
  const { attributes, listeners, setNodeRef, isDragging } = useDraggable({
    id: `${LIBRARY_DRAG_PREFIX}${ref}`,
    data: { material: ref },
  });

  return (
    <div className="relative">
      <button
        ref={onPick ? undefined : setNodeRef}
        type="button"
        title={item.name}
        onClick={() => (onPick ? onPick(ref) : setArmedMaterial(armed ? null : ref))}
        {...(onPick ? {} : listeners)}
        {...(onPick ? {} : attributes)}
        className={
          armed
            ? "relative flex h-12 w-12 shrink-0 touch-none cursor-grab select-none items-center justify-center rounded-[8px] border border-[var(--brand)] bg-[var(--brand-soft)] ring-1 ring-[var(--brand)] active:cursor-grabbing"
            : "relative flex h-12 w-12 shrink-0 touch-none cursor-grab select-none items-center justify-center rounded-[8px] border border-[var(--border)] bg-[var(--surface-inset)] hover:border-[var(--border-strong)] active:cursor-grabbing"
        }
        style={{ opacity: isDragging ? 0.4 : 1 }}
      >
        {textureUrl ? (
          <img
            src={textureUrl}
            alt={item.name}
            draggable={false}
            className="h-3/4 w-3/4 object-contain"
            style={{ imageRendering: "pixelated" }}
          />
        ) : (
          <span className="px-0.5 text-[8px] text-[var(--text-mut)]">
            {(display.material ?? "?").slice(0, 6)}
          </span>
        )}
        {display.enchanted ? (
          <span
            aria-hidden
            className="pointer-events-none absolute top-0 left-0.5 text-[9px] text-[#c77dff] drop-shadow"
          >
            ✦
          </span>
        ) : null}
      </button>
      <button
        type="button"
        data-testid={`remove-captured-${item.id}`}
        onClick={onRemove}
        className="absolute -top-1 -right-1 flex h-4 w-4 items-center justify-center rounded-full bg-[var(--surface-raised-2)] text-[9px] text-[var(--text-faint)] hover:text-[var(--danger)]"
      >
        ×
      </button>
    </div>
  );
}

/** One inventory slot from the mirror — click to capture into the project. */
function InventoryTile({
  slot,
  onCapture,
}: {
  slot: InventorySlotPayload;
  onCapture: () => void;
}) {
  const materialUrl = useTextureUrl(slot.display.material ?? "");
  const textureUrl = slot.display.head_texture
    ? (headPreviewUrl(`basehead:${slot.display.head_texture}`) ?? materialUrl)
    : materialUrl;
  const label = slot.display.name ?? slot.display.material ?? `#${slot.slot}`;

  return (
    <button
      type="button"
      data-testid={`capture-slot-${slot.slot}`}
      title={label}
      onClick={onCapture}
      className="relative flex h-12 w-12 shrink-0 items-center justify-center rounded-[8px] border border-dashed border-[var(--border)] bg-[var(--surface-inset)] hover:border-[var(--brand)]"
    >
      {textureUrl ? (
        <img
          src={textureUrl}
          alt={label}
          draggable={false}
          className="h-3/4 w-3/4 object-contain"
          style={{ imageRendering: "pixelated" }}
        />
      ) : (
        <span className="px-0.5 text-[8px] text-[var(--text-mut)]">
          {(slot.display.material ?? "?").slice(0, 6)}
        </span>
      )}
      {slot.display.count && slot.display.count > 1 ? (
        <span className="absolute right-0.5 bottom-0 font-mono text-[9px] text-[var(--text)]">
          {slot.display.count}
        </span>
      ) : null}
    </button>
  );
}
