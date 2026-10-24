import { cx } from "@/lib/cx";
import type { MmProfile } from "@/lib/mm/profiles";
import type { PlaceholderEntry } from "@/lib/placeholderCatalog";
import type { ReactNode } from "react";
import { useTranslation } from "react-i18next";
import { MmEditor } from "./MmEditor";
import { MmPreview } from "./MmPreview";
import type { MmViewMode } from "./mmCodeMirror";

export interface MmTextFieldProps {
  value: string;
  onChange: (value: string) => void;
  profile: MmProfile;
  /**
   * `inline`: the preview under the input. `column`: beside it. `none`: no preview here —
   * the screen draws its own elsewhere (an item card in a side column) from the same value.
   */
  layout?: "inline" | "column" | "none";
  /** Replaces the profile's default preview. */
  preview?: (value: string) => ReactNode;
  entries?: PlaceholderEntry[];
  initialMode?: MmViewMode;
  minHeight?: string;
  "aria-label"?: string;
  className?: string;
}

/**
 * What a screen puts where a MiniMessage text is edited: the rich input and the in-game
 * preview its profile calls for, laid out as asked.
 */
export function MmTextField({
  value,
  onChange,
  profile,
  layout = "inline",
  preview,
  entries,
  initialMode,
  minHeight,
  "aria-label": ariaLabel,
  className,
}: MmTextFieldProps) {
  const { t } = useTranslation();
  const editor = (
    <MmEditor
      value={value}
      onChange={onChange}
      profile={profile}
      entries={entries}
      initialMode={initialMode}
      minHeight={minHeight}
      aria-label={ariaLabel}
    />
  );
  if (layout === "none") return <div className={className}>{editor}</div>;
  const rendered = preview ? preview(value) : <MmPreview value={value} profile={profile} />;
  return (
    <div
      className={cx(
        layout === "column"
          ? "grid gap-4 md:grid-cols-[minmax(0,1fr)_minmax(0,1fr)]"
          : "flex flex-col gap-3",
        className,
      )}
    >
      {editor}
      <section aria-label={t("mmEditor.previewLabel")} className="min-w-0 overflow-x-auto">
        {rendered}
      </section>
    </div>
  );
}
