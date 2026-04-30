import { newElementId, newLayerId, newPackId } from "@/domain/ids";
import { assertPackHermetic } from "@/domain/invariants";
import type { Account, CommandId, Layer, MenuId, PackId } from "@/domain/types";
import { mockAccount } from "@/mock/fixtures";
import { produce } from "immer";
import { temporal } from "zundo";
import { create } from "zustand";
import { persist } from "zustand/middleware";

type MenuRows = 1 | 2 | 3 | 4 | 5 | 6;

interface AccountState {
  account: Account;
  createPack: (input: { name: string; description?: string }) => void;
  reorderPacks: (newOrder: PackId[]) => void;
  moveMenuToPack: (input: { menuId: MenuId; fromPackId: PackId; toPackId: PackId }) => void;
  setCanvasPosition: (input: { packId: PackId; nodeId: string; x: number; y: number }) => void;
  deleteFromPack: (input: { packId: PackId; nodeIds: string[] }) => void;
  setPackField: (input: { packId: PackId; field: "name" | "description"; value: string }) => void;
  setMenuField: (input: {
    packId: PackId;
    menuId: MenuId;
    field: "title" | "permission" | "rows";
    value: string | MenuRows;
  }) => void;
  setCommandField: (input: {
    packId: PackId;
    commandId: CommandId;
    field: "name" | "permission" | "description";
    value: string;
  }) => void;
  setSlotMaterial: (input: {
    packId: PackId;
    menuId: MenuId;
    position: number;
    material: string;
  }) => void;
}

/**
 * Middleware order: temporal(persist(stateCreator)).
 *
 * `temporal` wraps the persisted state creator so undo/redo replays the
 * `account` slice. Action functions are stable refs, so excluding them via
 * `partialize` keeps the diff narrow.
 *
 * Account-level mutations (createPack, reorderPacks) clear the temporal
 * stack themselves so they don't tangle with pack-internal edits in the
 * undo history. Pack-internal mutations (slot material, field edits, canvas
 * position, deleteFromPack, moveMenuToPack) are undoable.
 */
const clearTemporal = () => useAccountStore.temporal.getState().clear();

export const useAccountStore = create<AccountState>()(
  temporal(
    persist(
      (set, get) => ({
        account: mockAccount(),
        createPack: ({ name, description }) => {
          set(
            produce((draft: AccountState) => {
              const id = newPackId();
              draft.account.packs.push({
                id,
                name,
                description,
                source: "user_created",
                createdAt: new Date().toISOString(),
                updatedAt: new Date().toISOString(),
                menus: [],
                commands: [],
                templates: [],
                assets: [],
                i18nKeys: {},
                defaultLang: "en",
                canvasLayout: {},
              });
              draft.account.packOrder.push(id);
            }),
          );
          clearTemporal();
        },
        reorderPacks: (newOrder) => {
          set(
            produce((draft: AccountState) => {
              draft.account.packOrder = [...newOrder];
            }),
          );
          clearTemporal();
        },
        moveMenuToPack: ({ menuId: mId, fromPackId, toPackId }) => {
          const next = produce(get().account, (draft) => {
            const from = draft.packs.find((p) => p.id === fromPackId);
            const to = draft.packs.find((p) => p.id === toPackId);
            if (!from || !to) throw new Error("pack not found");
            const idx = from.menus.findIndex((m) => m.id === mId);
            if (idx === -1) throw new Error("menu not found in source pack");
            const [moved] = from.menus.splice(idx, 1);
            if (!moved) return;
            moved.packId = toPackId;
            to.menus.push(moved);
          });
          const fromAfter = next.packs.find((p) => p.id === fromPackId)!;
          const toAfter = next.packs.find((p) => p.id === toPackId)!;
          assertPackHermetic(fromAfter);
          assertPackHermetic(toAfter);
          set({ account: next });
        },
        setCanvasPosition: ({ packId: pId, nodeId, x, y }) =>
          set(
            produce((draft: AccountState) => {
              const pack = draft.account.packs.find((p) => p.id === pId);
              if (!pack) return;
              (pack.canvasLayout as Record<string, { x: number; y: number }>)[nodeId] = { x, y };
            }),
          ),
        setPackField: ({ packId: pId, field, value }) =>
          set(
            produce((draft: AccountState) => {
              const pack = draft.account.packs.find((p) => p.id === pId);
              if (!pack) return;
              if (field === "name") pack.name = value;
              else if (field === "description") pack.description = value || undefined;
              pack.updatedAt = new Date().toISOString();
            }),
          ),
        setMenuField: ({ packId: pId, menuId: mId, field, value }) => {
          const next = produce(get().account, (draft) => {
            const pack = draft.packs.find((p) => p.id === pId);
            if (!pack) return;
            const menu = pack.menus.find((m) => m.id === mId);
            if (!menu) return;
            if (field === "title") {
              if (typeof value !== "string") return;
              menu.title = value;
            } else if (field === "permission") {
              if (typeof value !== "string") return;
              menu.permission = value || undefined;
            } else if (field === "rows") {
              if (typeof value !== "number") return;
              const maxPos = value * 9 - 1;
              const overflow = menu.layers.some((l) =>
                l.elements.some((el) => Number(el.positions) > maxPos),
              );
              if (overflow) {
                throw new Error(
                  `cannot shrink to ${value} rows: elements exist past position ${maxPos}`,
                );
              }
              menu.rows = value;
            }
            pack.updatedAt = new Date().toISOString();
          });
          const after = next.packs.find((p) => p.id === pId);
          if (after) assertPackHermetic(after);
          set({ account: next });
        },
        setCommandField: ({ packId: pId, commandId: cId, field, value }) =>
          set(
            produce((draft: AccountState) => {
              const pack = draft.account.packs.find((p) => p.id === pId);
              if (!pack) return;
              const cmd = pack.commands.find((c) => c.id === cId);
              if (!cmd) return;
              if (field === "name") cmd.name = value;
              else if (field === "permission") cmd.permission = value || undefined;
              else if (field === "description") cmd.description = value || undefined;
              pack.updatedAt = new Date().toISOString();
            }),
          ),
        setSlotMaterial: ({ packId: pId, menuId: mId, position, material }) =>
          set(
            produce((draft: AccountState) => {
              const pack = draft.account.packs.find((p) => p.id === pId);
              if (!pack) return;
              const menu = pack.menus.find((m) => m.id === mId);
              if (!menu) return;
              const positionStr = String(position);
              for (const layer of menu.layers) {
                for (const el of layer.elements) {
                  if (el.positions !== positionStr) continue;
                  const appearance = el.appearances[0];
                  if (appearance) appearance.material = material;
                  pack.updatedAt = new Date().toISOString();
                  return;
                }
              }
              let firstLayer: Layer | undefined = menu.layers[0];
              if (!firstLayer) {
                firstLayer = { id: newLayerId(), name: "default", elements: [] };
                menu.layers.push(firstLayer);
              }
              firstLayer.elements.push({
                id: newElementId(),
                positions: positionStr,
                appearances: [{ material }],
              });
              pack.updatedAt = new Date().toISOString();
            }),
          ),
        deleteFromPack: ({ packId: pId, nodeIds }) => {
          const ids = new Set(nodeIds);
          const next = produce(get().account, (draft) => {
            const pack = draft.packs.find((p) => p.id === pId);
            if (!pack) return;
            pack.menus = pack.menus.filter((m) => !ids.has(m.id));
            pack.commands = pack.commands.filter((c) => !ids.has(c.id));
            for (const id of ids) {
              delete (pack.canvasLayout as Record<string, { x: number; y: number }>)[id];
            }
          });
          const after = next.packs.find((p) => p.id === pId);
          if (!after) return;
          assertPackHermetic(after);
          set({ account: next });
        },
      }),
      { name: "interfaze:account" },
    ),
    {
      // Track only the account slice so action references aren't diffed.
      partialize: (state) => ({ account: state.account }),
      // Drop the very-frequent canvasPosition writes from history when the
      // user is just dragging menus around (otherwise undo replays each px).
      // Equality lets temporal collapse identical states.
      equality: (a, b) => a.account === b.account,
      limit: 100,
    },
  ),
);
