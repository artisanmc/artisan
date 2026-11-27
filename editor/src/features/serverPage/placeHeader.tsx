import { displayServerLabel } from "@/lib/serverLabel";
import { useAuthStore } from "@/state/authStore";
import { type ReactNode, useContext, useMemo } from "react";
import { ServerTabs } from "./ServerTabs";
import { ServerFrameContext } from "./serverFrame";

const NO_PERMISSIONS: readonly string[] = [];

/**
 * The server's header for a place of its resources (its library, a theme): the server's name
 * and its tabs with Resources active. Such a place is a Project, whose page would otherwise
 * show a module's header: opening the server's Resources would look like leaving the server.
 * `undefined` outside the server's page.
 */
export function useServerPlaceHeader(): { title: ReactNode; nav: ReactNode } | undefined {
  const frame = useContext(ServerFrameContext);
  const permissions = useAuthStore((s) => s.currentUser?.permissions);
  return useMemo(
    () =>
      frame
        ? {
            title: (
              <h1
                className="min-w-0 truncate text-[17px] font-semibold tracking-tight text-[var(--text)]"
                data-testid="place-server-name"
              >
                {frame.summary ? displayServerLabel(frame.summary) : frame.serverId}
              </h1>
            ),
            nav: (
              <ServerTabs
                serverId={frame.serverId}
                active="/servers/$serverId/resources"
                permissions={permissions ?? NO_PERMISSIONS}
              />
            ),
          }
        : undefined,
    [frame, permissions],
  );
}
