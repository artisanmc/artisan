import { Input } from "@/components/ui/input";
import type { Asset } from "@/domain/asset";
import type { ProjectId } from "@/domain/types";
import { patchAsset } from "@/lib/api/userAssets";
import type { Slice } from "@/lib/pack/slice";
import { useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import { StudioSection } from "./StudioFrame";
import { useAssetStore } from "./assetStore";

const SIDES = ["left", "right", "top", "bottom"] as const;
const NONE: Slice = { left: 0, right: 0, top: 0, bottom: 0 };

const asText = (slice: Slice) =>
  Object.fromEntries(SIDES.map((side) => [side, String(slice[side])])) as Record<
    (typeof SIDES)[number],
    string
  >;

/**
 * The margins of a sliced image (`lib/pack/slice.ts`), in the atelier's right column: the
 * pixels kept as drawn at each edge, the rest repeated to fill a button's slots. A margin is
 * written to the image's file when its field is left; all at 0, the image is drawn by its fit.
 */
export function SlicePanel({
  projectId,
  asset,
  disabled,
}: {
  projectId: ProjectId;
  asset: Asset;
  disabled?: boolean;
}) {
  const { t } = useTranslation();
  const current = asset.slice ?? NONE;
  const [text, setText] = useState(() => asText(current));
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const { left, right, top, bottom } = current;
  // biome-ignore lint/correctness/useExhaustiveDependencies: the fields follow the saved margins
  useEffect(() => {
    setText(asText({ left, right, top, bottom }));
    setError(null);
  }, [asset.id, left, right, top, bottom]);

  const commit = async () => {
    const next = { ...NONE };
    for (const side of SIDES) {
      const n = text[side].trim() === "" ? 0 : Number(text[side]);
      if (!Number.isInteger(n) || n < 0) return setError(t("studio.slice.whole"));
      next[side] = n;
    }
    if (SIDES.every((side) => next[side] === current[side])) return setError(null);
    if (
      asset.width > 0 &&
      (next.left + next.right >= asset.width || next.top + next.bottom >= asset.height)
    )
      return setError(t("studio.slice.tooLarge"));
    setError(null);
    setBusy(true);
    try {
      const none = SIDES.every((side) => next[side] === 0);
      useAssetStore
        .getState()
        .upsertAsset(await patchAsset(projectId, asset.id, { slice: none ? null : next }));
    } catch (failure) {
      setError(failure instanceof Error ? failure.message : String(failure));
    } finally {
      setBusy(false);
    }
  };

  return (
    <StudioSection title={t("studio.slice.label")} testId="studio-slice">
      <div className="grid grid-cols-4 gap-1.5">
        {SIDES.map((side) => (
          // biome-ignore lint/a11y/noLabelWithoutControl: Input renders an <input>
          <label key={side} className="flex flex-col gap-0.5">
            <span className="field-label">{t(`studio.slice.${side}`)}</span>
            <Input
              type="number"
              min={0}
              step={1}
              inputMode="numeric"
              className="h-7 px-1.5 text-xs"
              value={text[side]}
              disabled={disabled || busy}
              onChange={(event) => setText({ ...text, [side]: event.target.value })}
              onBlur={() => void commit()}
              onKeyDown={(event) => {
                // The atelier's keys (tools, undo) are not for a field.
                event.stopPropagation();
                if (event.key === "Enter") void commit();
              }}
            />
          </label>
        ))}
      </div>
      {error ? (
        <p role="alert" className="text-[11px] text-[var(--danger)]">
          {error}
        </p>
      ) : (
        <p className="text-[11px] text-[var(--text-faint)]">{t("studio.slice.hint")}</p>
      )}
    </StudioSection>
  );
}
