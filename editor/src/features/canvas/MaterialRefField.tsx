import { Input } from "@/components/ui/input";
import { resolveDisplayRef } from "@/domain/capturedItems";
import type { ProjectId } from "@/domain/types";
import { useAccountStore } from "@/state/accountStore";
import { useTranslation } from "react-i18next";
import { MaterialPicker } from "./MaterialPicker";
import { headPreviewUrl } from "./headTexture";
import { useTextureUrl } from "./textureStore";

/**
 * Universal material-ref field — the `material` widget of the MC field kit
 * (ADR `captured-items-and-module-field-kit` §4). Accepts every ref the
 * runtime accepts: vanilla names, custom ids (`nexo:…`), captured items
 * (`item:<id>`), and `{placeholder}` templates. Renders a live preview tile
 * (head texture > custom/vanilla texture), opens the Library picker on tile
 * click, and offers the project's captured items in a dropdown.
 */
export function MaterialRefField({
  projectId,
  value,
  onChange,
  className,
}: {
  projectId: ProjectId;
  value: string;
  onChange: (v: string) => void;
  className?: string;
}) {
  const { t } = useTranslation();
  const pack = useAccountStore((s) => s.account.projects.find((p) => p.id === projectId));
  const display = pack ? resolveDisplayRef(pack, value) : { material: value };
  const materialUrl = useTextureUrl(display.material);
  const textureUrl = headPreviewUrl(display.head) ?? materialUrl;
  const captured = pack?.capturedItems ?? [];

  return (
    <div className={`flex items-center gap-1.5 ${className ?? ""}`}>
      <MaterialPicker
        trigger={
          <button
            type="button"
            title={t("mcFields.pickMaterial")}
            className="flex h-8 w-8 shrink-0 items-center justify-center rounded border border-[var(--border-soft)] bg-[var(--surface)] hover:border-[var(--brand)]"
          >
            {textureUrl ? (
              <img
                src={textureUrl}
                alt={display.material}
                draggable={false}
                className="h-3/4 w-3/4 object-contain"
                style={{ imageRendering: "pixelated" }}
              />
            ) : (
              <span className="text-[8px] text-[var(--text-faint)]">
                {(display.material ?? "").slice(0, 4) || "—"}
              </span>
            )}
          </button>
        }
        onPick={onChange}
      />
      <Input
        value={value}
        onChange={(e) => onChange(e.target.value)}
        className="h-8 min-w-0 flex-1 px-2 font-mono text-xs"
      />
      {captured.length > 0 ? (
        <select
          data-testid="material-ref-captured"
          value={value.startsWith("item:") ? value : ""}
          onChange={(e) => {
            if (e.target.value) onChange(e.target.value);
          }}
          className="h-8 w-28 shrink-0 rounded border border-[var(--border-soft)] bg-[var(--surface-raised)] px-1.5 text-xs text-[var(--text)]"
        >
          <option value="">{t("mcFields.capturedOption")}</option>
          {captured.map((ci) => (
            <option key={ci.id} value={`item:${ci.id}`}>
              {ci.name}
            </option>
          ))}
        </select>
      ) : null}
    </div>
  );
}
