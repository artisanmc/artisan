import type { TFunction } from "i18next";
import { toast } from "sonner";

import { isProEdition } from "@/lib/edition";

/**
 * After a disk write, rebuilds the resource pack in the browser and sends it
 * to the plugin, without blocking publication. A failure leaves the previous
 * pack in place and shows a toast. The builder is only loaded at that point.
 * Unknown server: nothing is rebuilt, rather than another server's pack.
 * Free jar: nothing either, building a pack is Pro; the hub keeps the pack it has.
 */
export function rebuildServerPackInBackground(
  t: TFunction,
  serverId: string | null | undefined,
): void {
  if (!serverId || !isProEdition()) return;
  void import("@/lib/pack/buildServerPack")
    .then(({ requestResourcePackRebuild }) => requestResourcePackRebuild(serverId))
    .catch((error: unknown) => {
      console.warn("[resource-pack]", error);
      toast.error(t("deploy.packFailed"), { id: "resource-pack-rebuild" });
    });
}
