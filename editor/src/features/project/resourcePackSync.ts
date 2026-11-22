import { getServerConfig } from "@/lib/api/serverConfig";
import type { TFunction } from "i18next";
import { toast } from "sonner";

const DELEGATE_DIR = "resource-pack.delegate-to-dir";
const RELOAD_COMMAND = "resource-pack.delegate-reload-command";
const hashKey = (serverId: string) => `artisan.pack-hash.${serverId}`;

/** The pack hash this browser last saw for the server; null when none or storage is closed. */
function lastHash(serverId: string): string | null {
  try {
    return localStorage.getItem(hashKey(serverId));
  } catch {
    return null;
  }
}

function rememberHash(serverId: string, hash: string): void {
  try {
    localStorage.setItem(hashKey(serverId), hash);
  } catch {
    // Storage closed: the next change is simply not announced.
  }
}

/**
 * Says the pack changed when a pack plugin (Nexo, Oraxen…) serves it: what players see (a new
 * or moved image, a symbol) only shows once that plugin reloads. Without a reload command
 * nothing serves the new pack until someone reloads by hand, so that case is a warning.
 * Sent by Artisan itself, the pack reaches players on its own: nothing to say. Same with the
 * config unreadable (server off): it has not applied the pack yet.
 */
async function announcePackChange(t: TFunction, serverId: string): Promise<void> {
  let config: Record<string, unknown> | null = null;
  try {
    config = (await getServerConfig(serverId)).config;
  } catch {
    return;
  }
  const text = (key: string) => {
    const value = config?.[key];
    return typeof value === "string" ? value.trim() : "";
  };
  if (!text(DELEGATE_DIR)) return;
  const command = text(RELOAD_COMMAND);
  if (command)
    toast.info(t("deploy.packChanged"), {
      id: "resource-pack-changed",
      description: t("deploy.packChangedReloaded", { command }),
    });
  else
    toast.warning(t("deploy.packChanged"), {
      id: "resource-pack-changed",
      description: t("deploy.packChangedNoReload"),
      duration: 15000,
    });
}

/**
 * After a disk write, rebuilds the resource pack in the browser and sends it
 * to the plugin, without blocking publication. A failure leaves the previous
 * pack in place and shows a toast. The builder is only loaded at that point.
 * Unknown server: nothing is rebuilt, rather than another server's pack.
 * A pack that differs from the last one seen for this server is announced.
 */
export function rebuildServerPackInBackground(
  t: TFunction,
  serverId: string | null | undefined,
): void {
  if (!serverId) return;
  void import("@/lib/pack/buildServerPack")
    .then(({ requestResourcePackRebuild }) => requestResourcePackRebuild(serverId))
    .then((hash) => {
      if (!hash) return;
      const before = lastHash(serverId);
      rememberHash(serverId, hash);
      // The first pack seen for a server has nothing to differ from.
      if (before && before !== hash) return announcePackChange(t, serverId);
    })
    .catch((error: unknown) => {
      console.warn("[resource-pack]", error);
      // The reason is shown too: the admin can hand it on without opening the console.
      const reason = error instanceof Error ? error.message : String(error);
      toast.error(t("deploy.packFailed"), {
        id: "resource-pack-rebuild",
        description: t("deploy.packFailedReason", { reason }),
      });
    });
}
