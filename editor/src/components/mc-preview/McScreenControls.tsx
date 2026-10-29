import { Segmented } from "@/components/ui/segmented";
import {
  type GuiScaleChoice,
  MC_SCREEN_PRESETS,
  guiScale,
  maxGuiScale,
  mcScreenLayout,
} from "@artisan/editor-sdk";
import { useTranslation } from "react-i18next";

/** What `McScreen` is previewed at: the window, the GUI scale option, the zoom. */
export interface McScreenSettings {
  width: number;
  height: number;
  guiScale: GuiScaleChoice;
  zoom: "fit" | 1;
}

/**
 * The window size (the presets), the GUI scale as the game offers it (Auto, then 1 to the
 * window's largest) and the zoom, with the GUI size they give.
 */
export function McScreenControls({
  value,
  onChange,
}: {
  value: McScreenSettings;
  onChange: (next: McScreenSettings) => void;
}) {
  const { t } = useTranslation();
  const max = maxGuiScale(value.width, value.height);
  const scale = guiScale(value.width, value.height, value.guiScale);
  const layout = mcScreenLayout(value.width, value.height, scale);
  const scales: { value: string; label: string }[] = [
    { value: "auto", label: t("mcScreen.auto") },
    ...Array.from({ length: max }, (_, k) => ({ value: String(k + 1), label: String(k + 1) })),
  ];
  return (
    <div className="flex flex-wrap items-end gap-3" data-testid="mc-screen-controls">
      <label className="field-label flex flex-col gap-1">
        {t("mcScreen.window")}
        <select
          className="input"
          value={`${value.width}x${value.height}`}
          onChange={(event) => {
            const [width, height] = event.target.value.split("x").map(Number);
            const next = { ...value, width: width!, height: height! };
            // A fixed scale the new window cannot hold goes back to Auto, as in game.
            if (value.guiScale !== "auto" && value.guiScale > maxGuiScale(width!, height!)) {
              next.guiScale = "auto";
            }
            onChange(next);
          }}
        >
          {MC_SCREEN_PRESETS.map((p) => (
            <option key={`${p.width}x${p.height}`} value={`${p.width}x${p.height}`}>
              {p.width}×{p.height}
            </option>
          ))}
        </select>
      </label>
      <div className="field-label flex flex-col gap-1">
        {t("mcScreen.guiScale")}
        <Segmented
          label={t("mcScreen.guiScale")}
          options={scales}
          value={String(value.guiScale)}
          onChange={(v) => onChange({ ...value, guiScale: v === "auto" ? "auto" : Number(v) })}
        />
      </div>
      <div className="field-label flex flex-col gap-1">
        {t("mcScreen.zoom")}
        <Segmented
          label={t("mcScreen.zoom")}
          options={[
            { value: "fit", label: t("mcScreen.fit") },
            { value: "1", label: t("mcScreen.actual") },
          ]}
          value={String(value.zoom)}
          onChange={(v) => onChange({ ...value, zoom: v === "fit" ? "fit" : 1 })}
        />
      </div>
      <span className="mono pb-1.5 text-[11px] text-[var(--text-faint)]">
        {t("mcScreen.guiSize", { width: layout.width, height: layout.height, scale })}
      </span>
    </div>
  );
}
