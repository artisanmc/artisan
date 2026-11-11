import { rebuildServerPackInBackground } from "@/features/project/resourcePackSync";
import type { TFunction } from "i18next";
import { toast } from "sonner";
import type { OtherDraft } from "./otherDrafts";
import { deployOtherDrafts } from "./useOtherDrafts";

/**
 * Deploys [queue] one draft after the other (the first failure stops the rest), rebuilds the
 * resource pack of each server written, and says how it went: what went out, what failed, what
 * was not tried. Deploy's review and the server's Assistant tab both end here.
 */
export async function deployDraftsAndReport(t: TFunction, queue: OtherDraft[]): Promise<void> {
  const report = await deployOtherDrafts(queue);
  for (const serverId of new Set(report.deployed.map((d) => d.serverId)))
    rebuildServerPackInBackground(t, serverId);
  const names = (list: OtherDraft[]) => list.map((d) => d.projectName).join(", ");
  if (!report.failed)
    toast.success(
      t("deploy.others.deployed", {
        count: report.deployed.length,
        names: names(report.deployed),
      }),
    );
  else
    toast.error(
      t("deploy.others.failed", {
        name: report.failed.draft.projectName,
        reason: t(`save.errors.${report.failed.code}`, {
          defaultValue: report.failed.code,
        }),
        deployed: report.deployed.length ? names(report.deployed) : "—",
        skipped: report.skipped.length ? names(report.skipped) : "—",
      }),
      { duration: 15_000 },
    );
}
