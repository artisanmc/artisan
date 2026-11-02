import { swatchHex } from "@/lib/mm/palettes";
import { Plus, X } from "lucide-react";
import { useTranslation } from "react-i18next";

export interface PaletteForm {
  swatches: { name: string; color: string }[];
  gradients: { name: string; stops: string[] }[];
}

const HEX = /^#[0-9a-f]{6}$/i;

function ColorInput({
  value,
  onChange,
  label,
}: { value: string; onChange: (v: string) => void; label: string }) {
  return (
    <input
      type="color"
      aria-label={label}
      value={HEX.test(value) ? value : "#ffffff"}
      onChange={(e) => onChange(e.target.value)}
      className="size-8 shrink-0 cursor-pointer rounded border border-[var(--border)] bg-transparent p-0"
    />
  );
}

/**
 * The server's text palette (`text-palette.*` of `config.yml`): named colors and
 * gradients the MiniMessage toolbar offers in every module of the server.
 */
export function TextPaletteFields({
  value,
  onChange,
}: { value: PaletteForm; onChange: (next: PaletteForm) => void }) {
  const { t } = useTranslation();
  const setSwatch = (i: number, patch: Partial<PaletteForm["swatches"][number]>) =>
    onChange({
      ...value,
      swatches: value.swatches.map((s, k) => (k === i ? { ...s, ...patch } : s)),
    });
  const setGradient = (i: number, patch: Partial<PaletteForm["gradients"][number]>) =>
    onChange({
      ...value,
      gradients: value.gradients.map((g, k) => (k === i ? { ...g, ...patch } : g)),
    });

  return (
    <div className="flex flex-col gap-5">
      <div className="flex flex-col gap-2">
        <span className="field-label">{t("serverConfig.palette.colors")}</span>
        {value.swatches.map((s, i) => (
          // biome-ignore lint/suspicious/noArrayIndexKey: entries are positional config strings, no id
          <div key={i} className="flex items-center gap-2">
            <ColorInput
              value={s.color}
              onChange={(color) => setSwatch(i, { color })}
              label={t("serverConfig.palette.colorOf", { name: s.name })}
            />
            <input
              className="input h-8 flex-1"
              aria-label={t("serverConfig.palette.name")}
              placeholder={t("serverConfig.palette.name")}
              value={s.name}
              onChange={(e) => setSwatch(i, { name: e.target.value })}
            />
            <code className="w-[72px] text-[12px] text-[var(--text-mut)]">{s.color}</code>
            <button
              type="button"
              className="btn btn-ghost btn-icon btn-sm"
              aria-label={t("serverConfig.palette.remove")}
              onClick={() =>
                onChange({ ...value, swatches: value.swatches.filter((_, k) => k !== i) })
              }
            >
              <X className="size-4" />
            </button>
          </div>
        ))}
        <button
          type="button"
          className="btn btn-ghost btn-sm self-start"
          onClick={() =>
            onChange({
              ...value,
              swatches: [
                ...value.swatches,
                { name: t("serverConfig.palette.newColor"), color: "#5ab4ff" },
              ],
            })
          }
        >
          <Plus className="size-4" />
          {t("serverConfig.palette.addColor")}
        </button>
      </div>

      <div className="flex flex-col gap-2">
        <span className="field-label">{t("serverConfig.palette.gradients")}</span>
        {value.gradients.map((g, i) => (
          // biome-ignore lint/suspicious/noArrayIndexKey: entries are positional config strings, no id
          <div key={i} className="flex flex-wrap items-center gap-2">
            <span
              aria-hidden
              className="h-4 w-14 shrink-0 rounded-sm border border-[var(--border)]"
              style={{
                background: `linear-gradient(to right, ${g.stops.map(swatchHex).join(", ")})`,
              }}
            />
            <input
              className="input h-8 min-w-32 flex-1"
              aria-label={t("serverConfig.palette.name")}
              placeholder={t("serverConfig.palette.name")}
              value={g.name}
              onChange={(e) => setGradient(i, { name: e.target.value })}
            />
            {g.stops.map((stop, k) => (
              <ColorInput
                // biome-ignore lint/suspicious/noArrayIndexKey: a stop is its position
                key={k}
                value={stop}
                label={t("serverConfig.palette.stopOf", { name: g.name, index: k + 1 })}
                onChange={(color) =>
                  setGradient(i, { stops: g.stops.map((s, j) => (j === k ? color : s)) })
                }
              />
            ))}
            <button
              type="button"
              className="btn btn-ghost btn-icon btn-sm"
              aria-label={t("serverConfig.palette.addStop")}
              onClick={() => setGradient(i, { stops: [...g.stops, g.stops.at(-1) ?? "#ffffff"] })}
            >
              <Plus className="size-4" />
            </button>
            {g.stops.length > 2 && (
              <button
                type="button"
                className="btn btn-ghost btn-sm"
                onClick={() => setGradient(i, { stops: g.stops.slice(0, -1) })}
              >
                {t("serverConfig.palette.removeStop")}
              </button>
            )}
            <button
              type="button"
              className="btn btn-ghost btn-icon btn-sm"
              aria-label={t("serverConfig.palette.remove")}
              onClick={() =>
                onChange({ ...value, gradients: value.gradients.filter((_, k) => k !== i) })
              }
            >
              <X className="size-4" />
            </button>
          </div>
        ))}
        <button
          type="button"
          className="btn btn-ghost btn-sm self-start"
          onClick={() =>
            onChange({
              ...value,
              gradients: [
                ...value.gradients,
                { name: t("serverConfig.palette.newGradient"), stops: ["#ff5f6d", "#ffc371"] },
              ],
            })
          }
        >
          <Plus className="size-4" />
          {t("serverConfig.palette.addGradient")}
        </button>
      </div>
    </div>
  );
}
