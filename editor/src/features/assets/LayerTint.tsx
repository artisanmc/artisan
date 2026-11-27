import { ColorInput } from "@/components/ui/color-input";
import type { Palette } from "@/lib/pack/palette";
import { useId } from "react";
import { useTranslation } from "react-i18next";

const COLOUR = /^#[0-9a-fA-F]{6}$/;
const CUSTOM = "#";

/**
 * The tint of a layer (`ComposeLayer.tint`, ADR `component-colours`): none, a name of the
 * palette, which follows the theme in place, or a colour of its own. A name no palette holds
 * stays listed and is said: the layer shows as drawn until a theme or the library gives it.
 */
export function LayerTint({
  value,
  names,
  palette,
  onChange,
}: {
  value: string | undefined;
  /** The names a palette of the server gives, the default ones first. */
  names: readonly string[];
  palette: Palette;
  onChange: (tint: string | undefined) => void;
}) {
  const { t } = useTranslation();
  const id = useId();
  const custom = value !== undefined && COLOUR.test(value);
  const unknown = value !== undefined && !custom && !names.includes(value);
  const shown = custom ? value : value === undefined ? undefined : palette(value);
  return (
    <div className="flex flex-col gap-1" data-testid="layer-tint">
      <label htmlFor={id} className="field-label">
        {t("compose.tint.label")}
      </label>
      <div className="flex items-center gap-2">
        <select
          id={id}
          className="input h-8 min-w-0 flex-1"
          value={custom ? CUSTOM : (value ?? "")}
          onChange={(e) => {
            const next = e.target.value;
            onChange(next === "" ? undefined : next === CUSTOM ? (shown ?? "#ffffff") : next);
          }}
        >
          <option value="">{t("compose.tint.none")}</option>
          {names.map((name) => (
            <option key={name} value={name}>
              {name}
            </option>
          ))}
          {unknown ? <option value={value}>{value}</option> : null}
          <option value={CUSTOM}>{t("compose.tint.custom")}</option>
        </select>
        {custom ? (
          <ColorInput value={value} onChange={onChange} label={t("compose.tint.colour")} />
        ) : shown ? (
          <span
            aria-hidden
            className="size-8 shrink-0 rounded-[8px] border border-[var(--border)]"
            style={{ background: shown }}
          />
        ) : null}
      </div>
      <p className="text-[11px] text-[var(--text-faint)]">
        {t(
          unknown
            ? "compose.tint.unknown"
            : custom || value === undefined
              ? "compose.tint.hint"
              : "compose.tint.namedHint",
          { name: value },
        )}
      </p>
    </div>
  );
}
