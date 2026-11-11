import type { ServerSummary } from "@/lib/api/servers";
import { createContext, useContext } from "react";

/**
 * What the server page's frame knows and its tabs share: the server, once the
 * network has confirmed it exists. Nothing live — the tabs load their own data.
 */
export interface ServerFrame {
  /** URL form (usually a slug) — the one links carry. */
  serverId: string;
  /** Real server_key id, `null` until the network has answered. */
  serverKeyId: string | null;
  /** The server as the hub lists it, `null` until the network has answered. */
  summary: ServerSummary | null;
}

export const ServerFrameContext = createContext<ServerFrame | null>(null);

export function useServerFrame(): ServerFrame {
  const frame = useContext(ServerFrameContext);
  if (!frame) throw new Error("useServerFrame outside the server page");
  return frame;
}
