import { create } from "zustand";
import { persist } from "zustand/middleware";

/** The sidebar's two lists of folders: the plugins' modules and the admin's own. */
export type SidebarSection = "installed" | "mine";

/** Order key of the lists shown without a server (the demo). */
const NO_SERVER = "";

interface SidebarOrderState {
  /** Per server, per section: the ids in the order the admin dragged them to. */
  orders: Record<string, Partial<Record<SidebarSection, string[]>>>;
  setOrder: (serverId: string | null, section: SidebarSection, ids: string[]) => void;
}

/**
 * The order of the sidebar's folders, kept in this browser and per server: the
 * same server lists the same folders, another one lists others. A preference of
 * the viewer, so it does not travel to the server's disk.
 */
export const useSidebarOrderStore = create<SidebarOrderState>()(
  persist(
    (set) => ({
      orders: {},
      setOrder: (serverId, section, ids) =>
        set((s) => {
          const key = serverId ?? NO_SERVER;
          return { orders: { ...s.orders, [key]: { ...s.orders[key], [section]: [...ids] } } };
        }),
    }),
    {
      name: "artisan-sidebar-order",
      partialize: (state) => ({ orders: state.orders }),
      // A hand-edited or older stored value must not break the sidebar.
      merge: (persisted, current) => {
        const stored = (persisted ?? {}) as Partial<SidebarOrderState>;
        const orders = stored.orders;
        return {
          ...current,
          orders: orders && typeof orders === "object" && !Array.isArray(orders) ? orders : {},
        };
      },
    },
  ),
);

export function sidebarOrderOf(
  orders: SidebarOrderState["orders"],
  serverId: string | null,
  section: SidebarSection,
): readonly string[] {
  const ids = orders[serverId ?? NO_SERVER]?.[section];
  return Array.isArray(ids) ? ids : [];
}

/**
 * [items] in the stored [order]: the ones it names first, in its order, then the
 * others in their incoming order. A folder added since keeps its default place
 * after the sorted ones; one removed since is simply skipped.
 */
export function applyOrder<T>(
  items: readonly T[],
  order: readonly string[],
  idOf: (item: T) => string,
): T[] {
  const rank = new Map(order.map((id, i) => [id, i]));
  const ranked = items.filter((item) => rank.has(idOf(item)));
  ranked.sort((a, b) => (rank.get(idOf(a)) ?? 0) - (rank.get(idOf(b)) ?? 0));
  return [...ranked, ...items.filter((item) => !rank.has(idOf(item)))];
}
