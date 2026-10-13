import { useUiStore } from "@/state/uiStore";
import { useTranslation } from "react-i18next";
import { useTextureUrl } from "./textureStore";

/**
 * Floating pill at the top of the Stage that shows when a Library item is
 * "armed" (touch flow), with a × to cancel. The next slot tap on the stage
 * places the armed material — see `onStageClick` in Stage.tsx.
 */
export function ArmedBanner() {
  const { t } = useTranslation();
  const armed = useUiStore((s) => s.armedMaterial);
  const setArmed = useUiStore((s) => s.setArmedMaterial);
  const url = useTextureUrl(armed ?? "");
  if (!armed) return null;
  return (
    <div
      className="-translate-x-1/2 absolute top-3 left-1/2 z-20 flex items-center gap-2.5 rounded-full border border-[var(--brand-line)] bg-[var(--surface-raised)]/95 px-3.5 py-1.5 text-[var(--text)] backdrop-blur"
      style={{ boxShadow: "var(--shadow-md)" }}
    >
      {url ? (
        <img
          src={url}
          alt={armed}
          className="h-5 w-5 object-contain"
          style={{ imageRendering: "pixelated" }}
        />
      ) : null}
      <span className="text-[12.5px]">
        <strong className="text-[var(--brand)] font-semibold">{armed}</strong>{" "}
        {t("canvas.armedHint")}
      </span>
      <button
        type="button"
        onClick={() => setArmed(null)}
        title={t("canvas.cancel")}
        className="flex h-6 w-6 items-center justify-center rounded-[10px] text-[14px] text-[var(--text-mut)] hover:bg-[var(--surface-hover)] hover:text-[var(--text)]"
      >
        ×
      </button>
    </div>
  );
}
