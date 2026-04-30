import { newPackId } from "@/domain/ids";
import { assertPackHermetic } from "@/domain/invariants";
import type { Account, MenuId, PackId } from "@/domain/types";
import { mockAccount } from "@/mock/fixtures";
import { produce } from "immer";
import { create } from "zustand";
import { persist } from "zustand/middleware";

interface AccountState {
  account: Account;
  createPack: (input: { name: string; description?: string }) => void;
  reorderPacks: (newOrder: PackId[]) => void;
  moveMenuToPack: (input: { menuId: MenuId; fromPackId: PackId; toPackId: PackId }) => void;
}

export const useAccountStore = create<AccountState>()(
  persist(
    (set, get) => ({
      account: mockAccount(),
      createPack: ({ name, description }) =>
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
        ),
      reorderPacks: (newOrder) =>
        set(
          produce((draft: AccountState) => {
            draft.account.packOrder = [...newOrder];
          }),
        ),
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
    }),
    { name: "interfaze:account" },
  ),
);
