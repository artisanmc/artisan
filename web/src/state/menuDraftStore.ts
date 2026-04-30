import { newElementId, newLayerId } from "@/domain/ids";
import type { Element, ElementId, Layer, Menu, MenuId, PackId } from "@/domain/types";
import { produce } from "immer";
import { temporal } from "zundo";
import { create } from "zustand";
import { useAccountStore } from "./accountStore";

interface MenuDraftState {
  menuId: MenuId | null;
  packId: PackId | null;
  draft: Menu | null;
  selectedElementId: ElementId | null;
  selectedPosition: number | null;
  load: (input: { menu: Menu; packId: PackId }) => void;
  selectPosition: (pos: number) => void;
  setMaterialAtPosition: (input: { position: number; material: string }) => void;
  setElementField: (input: {
    elementId: ElementId;
    field: "title" | "lore" | "count";
    value: string;
  }) => void;
  commit: () => void;
}

const findElementAtPosition = (
  menu: Menu,
  position: number,
): { element: Element; layer: Layer } | null => {
  for (const layer of menu.layers) {
    for (const el of layer.elements) {
      if (el.positions === String(position)) return { element: el, layer };
    }
  }
  return null;
};

const ensureLayer = (menu: Menu): Layer => {
  if (menu.layers[0]) return menu.layers[0];
  const layer: Layer = { id: newLayerId(), name: "default", elements: [] };
  menu.layers.push(layer);
  return layer;
};

export const useMenuDraftStore = create<MenuDraftState>()(
  temporal(
    (set, get) => ({
      menuId: null,
      packId: null,
      draft: null,
      selectedElementId: null,
      selectedPosition: null,
      load: ({ menu, packId }) =>
        set({
          menuId: menu.id,
          packId,
          draft: structuredClone(menu),
          selectedElementId: null,
          selectedPosition: null,
        }),
      selectPosition: (pos) =>
        set(
          produce((draft: MenuDraftState) => {
            draft.selectedPosition = pos;
            const found = draft.draft ? findElementAtPosition(draft.draft, pos) : null;
            draft.selectedElementId = found?.element.id ?? null;
          }),
        ),
      setMaterialAtPosition: ({ position, material }) =>
        set(
          produce((draft: MenuDraftState) => {
            if (!draft.draft) return;
            const found = findElementAtPosition(draft.draft, position);
            if (found) {
              const appearance = found.element.appearances[0];
              if (appearance) appearance.material = material;
              return;
            }
            const layer = ensureLayer(draft.draft);
            const el: Element = {
              id: newElementId(),
              positions: String(position),
              appearances: [{ material }],
            };
            layer.elements.push(el);
            draft.selectedElementId = el.id;
          }),
        ),
      setElementField: ({ elementId, field, value }) =>
        set(
          produce((draft: MenuDraftState) => {
            if (!draft.draft) return;
            for (const layer of draft.draft.layers) {
              for (const el of layer.elements) {
                if (el.id !== elementId) continue;
                const appearance = el.appearances[0];
                if (!appearance) return;
                if (field === "title") appearance.title = value;
                else if (field === "lore") appearance.lore = value.split("\n");
                else if (field === "count") appearance.count = Number(value) || 1;
              }
            }
          }),
        ),
      commit: () => {
        const { draft, packId } = get();
        if (!draft || !packId) return;
        useAccountStore.setState((s) =>
          produce(s, (acc) => {
            const pack = acc.account.packs.find((p) => p.id === packId);
            if (!pack) return;
            const idx = pack.menus.findIndex((m) => m.id === draft.id);
            if (idx === -1) return;
            pack.menus[idx] = draft;
          }),
        );
      },
    }),
    { partialize: (s) => ({ draft: s.draft }) },
  ),
);
