import { useTranslation } from "react-i18next";

import { Switch } from "@/components/ui/switch";
import type { Menu, ProjectId } from "@/domain/types";
import { useAccountStore } from "@/state/accountStore";

/**
 * First, fixed row of the composed title: the vanilla chest texture. Off
 * (`vanilla_texture: false`), the window is transparent in game and the menu
 * brings its own texture through image layers. Chests only.
 */
export function VanillaTextureLayer({ projectId, menu }: { projectId: ProjectId; menu: Menu }) {
  const { t } = useTranslation();
  const setMenuField = useAccountStore((s) => s.setMenuField);
  const chest = (menu.inventoryType ?? "chest") === "chest";
  const on = menu.vanillaTexture !== false;

  return (
    <div
      data-testid="vanilla-texture-layer"
      className="flex flex-col gap-1 rounded border border-[var(--border-soft)] bg-[var(--surface)] px-2 py-1.5"
    >
      <div className="flex items-center justify-between gap-2 text-xs text-[var(--text)]">
        <span>{t("menuProperties.vanillaTexture")}</span>
        <Switch
          checked={on || !chest}
          disabled={!chest}
          aria-label={t("menuProperties.vanillaTexture")}
          onCheckedChange={(value) =>
            setMenuField({ projectId, menuId: menu.id, field: "vanillaTexture", value })
          }
        />
      </div>
      <p className="text-[10.5px] text-[var(--text-mut)]">
        {t(
          !chest
            ? "menuProperties.vanillaTextureChestOnly"
            : on
              ? "menuProperties.vanillaTextureOnHint"
              : "menuProperties.vanillaTextureOffHint",
        )}
      </p>
    </div>
  );
}
