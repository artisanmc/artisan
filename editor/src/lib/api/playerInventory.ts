const API_URL = import.meta.env.VITE_API_URL ?? "";

export interface InventorySlotPayload {
  slot: number;
  stack_yaml: string;
  display: {
    material?: string;
    head_texture?: string;
    enchanted?: boolean;
    count?: number;
    name?: string;
  };
}

export type InventoryFetchResult =
  | { ok: true; slots: InventorySlotPayload[] }
  | { ok: false; error: "server_offline" | "fetch_timeout" | "player_not_found" | "fetch_error" | "network_error" };

/**
 * Snapshot of an online player's inventory, relayed to the connected plugin
 * (5 s hub timeout). Feeds the capture panel — each slot carries the opaque
 * serialized stack plus its display descriptor.
 */
export async function fetchPlayerInventory(
  networkId: string,
  serverId: string,
  player: string,
): Promise<InventoryFetchResult> {
  try {
    const res = await fetch(
      `${API_URL}/api/v1/networks/${networkId}/servers/${serverId}/player-inventory?player=${encodeURIComponent(player)}`,
      { credentials: "include" },
    );
    const body = (await res.json().catch(() => null)) as
      | { slots?: InventorySlotPayload[]; error?: string }
      | null;
    if (res.ok) return { ok: true, slots: body?.slots ?? [] };
    const known = ["server_offline", "fetch_timeout", "player_not_found", "fetch_error"] as const;
    const error = known.includes(body?.error as (typeof known)[number])
      ? (body?.error as (typeof known)[number])
      : "fetch_error";
    return { ok: false, error };
  } catch {
    return { ok: false, error: "network_error" };
  }
}
