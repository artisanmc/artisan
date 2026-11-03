import type { TFunction } from "i18next";
import { toast } from "sonner";

/**
 * After a disk write, rebuilds the resource pack in the browser and sends it
 * to the plugin, without blocking publication. A failure leaves the previous
 * pack in place and shows a toast. The builder is only loaded at that point.
 * Unknown server: nothing is rebuilt, rather than another server's pack.
 */
export function rebuildServerPackInBackground(
  t: TFunction,
  serverId: string | null | undefined,
): void {
  if (!serverId) return;
  void import("@/lib/pack/buildServerPack")
    .then(({ requestResourcePackRebuild }) => requestResourcePackRebuild(serverId))
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
