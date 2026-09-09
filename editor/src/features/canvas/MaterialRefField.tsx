import { Input } from "@/components/ui/input";
import { resolveDisplayRef } from "@/domain/capturedItems";
import type { ProjectId } from "@/domain/types";
import { useAccountStore } from "@/state/accountStore";
import { useTranslation } from "react-i18next";
import { MaterialPicker } from "./MaterialPicker";
import { useHeadPreviewUrl } from "./useHeadPreviewUrl";
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
  const project = useAccountStore((s) => s.account.projects.find((p) => p.id === projectId));
  const display = project ? resolveDisplayRef(project, value) : { material: value };
  const materialUrl = useTextureUrl(display.material);
  const textureUrl = useHeadPreviewUrl(display.head) ?? materialUrl;

  return (
    <div className={`flex items-center gap-1.5 ${className ?? ""}`}>
      <MaterialPicker
        projectId={projectId}
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
    </div>
  );
}
