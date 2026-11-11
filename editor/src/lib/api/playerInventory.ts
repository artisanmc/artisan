import { ApiError, apiFetch } from "./client";

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
  | {
      ok: false;
      error:
        | "server_offline"
        | "fetch_timeout"
        | "player_not_found"
        | "fetch_error"
        | "network_error";
    };

const KNOWN = ["server_offline", "fetch_timeout", "player_not_found", "fetch_error"] as const;

/**
 * Snapshot of an online player's inventory, relayed to the connected plugin
 * (5 s hub timeout). Feeds the capture panel — each slot carries the opaque
 * serialized stack plus its display descriptor.
 */
export async function fetchPlayerInventory(
  serverId: string,
  player: string,
): Promise<InventoryFetchResult> {
  try {
    const body = await apiFetch<{ slots?: InventorySlotPayload[] }>(
      `/api/v1/servers/${serverId}/player-inventory?player=${encodeURIComponent(player)}`,
    );
    return { ok: true, slots: body.slots ?? [] };
  } catch (error) {
    const failure = ApiError.from(error);
    if (failure.status === 0) return { ok: false, error: "network_error" };
    const known = KNOWN.find((code) => code === failure.code);
    return { ok: false, error: known ?? "fetch_error" };
  }
}
