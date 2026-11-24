import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Segmented } from "@/components/ui/segmented";
import type { Asset, AssetUsage } from "@/domain/asset";
import type { ProjectId } from "@/domain/types";
import { composeAsset } from "@/lib/api/userAssets";
import { KIT_ASCENT, KIT_PREFIX } from "@/lib/pack/kit";
import { useProjectPrincipalId } from "@/lib/projectPrincipal";
import { useId, useState } from "react";
import { useTranslation } from "react-i18next";
import { useAssetStore } from "./assetStore";

/** What a new composed image starts from, by what it is for: a kit piece to build on. */
const START: Record<AssetUsage, string> = {
  menu: `${KIT_PREFIX}window.6`,
  button: `${KIT_PREFIX}button.3x1`,
};

/**
 * Starts a composed image (`lib/pack/compose.ts`): a name, what it is for, and a first layer
 * from the kit. Its layers are then edited in `ComposedImageEditor`.
 */
export function ComposeNewDialog({
  projectId,
  open,
  onClose,
  onCreated,
}: {
  projectId: ProjectId;
  open: boolean;
  onClose: () => void;
  onCreated: (asset: Asset) => void;
}) {
  const { t } = useTranslation();
  const nameId = useId();
  const user = useProjectPrincipalId(projectId);
  const upsertAsset = useAssetStore((s) => s.upsertAsset);
  const [name, setName] = useState("");
  const [usage, setUsage] = useState<AssetUsage>("menu");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const valid = /^[a-z0-9_-]+$/.test(name);

  const create = async () => {
    if (!user || !valid || busy) return;
    setBusy(true);
    setError(null);
    try {
      const asset = await composeAsset(projectId, {
        name,
        usages: [usage],
        // A window is drawn from the top edge of the title, as the kit's are.
        ...(usage === "menu" ? { ascent: KIT_ASCENT } : {}),
        recipe: {
          layers: [{ image: START[usage], x: 0, y: 0, columns: 1, rows: 1 }],
          width: null,
          height: null,
        },
      });
      upsertAsset(asset);
      setName("");
      onCreated(asset);
      onClose();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : String(cause));
    } finally {
      setBusy(false);
    }
  };

  return (
    <Dialog
      open={open}
      onOpenChange={(o) => {
        if (!o) onClose();
      }}
    >
      <DialogContent>
        <DialogHeader>
          <DialogTitle>{t("compose.newTitle")}</DialogTitle>
        </DialogHeader>
        <div className="flex flex-col gap-3">
          <p className="text-xs text-[var(--text-mut)]">{t("compose.newHint")}</p>
          <label className="text-xs" htmlFor={nameId}>
            {t("assetUpload.name")}
            <Input
              id={nameId}
              value={name}
              onChange={(event) => setName(event.target.value)}
              placeholder={t("assetUpload.namePlaceholder")}
            />
          </label>
          <Segmented
            label={t("compose.newFor")}
            value={usage}
            onChange={setUsage}
            options={[
              { value: "menu", label: t("compose.newWindow") },
              { value: "button", label: t("compose.newButton") },
            ]}
          />
          {error && (
            <p role="alert" className="text-xs text-[var(--danger)]">
              {error}
            </p>
          )}
          <div className="flex justify-end gap-2">
            <Button variant="ghost" onClick={onClose}>
              {t("assetUpload.cancel")}
            </Button>
            <Button disabled={busy || !valid || !user} onClick={() => void create()}>
              {t("compose.newCreate")}
            </Button>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}
