import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Input } from "@/components/ui/input";
import { type Asset, assetPreviewUrl } from "@/domain/asset";
import { cx } from "@/lib/cx";
import { useAuthenticatedImageUrl } from "@/lib/useAuthenticatedImage";
import { ArrowDown, ArrowUp, Pencil, Plus, Trash2 } from "lucide-react";
import { type ReactNode, useState } from "react";
import { useTranslation } from "react-i18next";
import { StudioSection } from "./StudioFrame";

/** One layer of an image, as the atelier lists it. */
export interface LayerRow {
  /** Its place in the stack, from the bottom. */
  index: number;
  label: string;
  /** The image the layer shows; none when the layer names an image that is not there. */
  image?: Asset;
  /** The layer as it is drawn now, in place of its saved file. */
  picture?: string;
  /** `3 × 2` for a layer repeated as a grid. */
  repeat?: string;
  /** A common image: placed here, redrawn among the common images. */
  common?: boolean;
  /** Gives the layer another name; the reason it cannot take it, else `null`. Absent: it keeps its name. */
  rename?: (name: string) => string | null;
}

function Thumb({ image, picture }: { image?: Asset; picture?: string }) {
  const fetched = useAuthenticatedImageUrl(image && !picture ? assetPreviewUrl(image) : "");
  const url = picture || fetched;
  return (
    <span
      aria-hidden
      className="checker block size-7 shrink-0 overflow-hidden rounded-[4px] border border-[var(--border)]"
    >
      <span
        className="block size-full"
        style={{
          backgroundImage: url ? `url("${url}")` : undefined,
          backgroundSize: "contain",
          backgroundPosition: "center",
          backgroundRepeat: "no-repeat",
          imageRendering: "pixelated",
        }}
      />
    </span>
  );
}

/**
 * The layers of the image open in the atelier, the top one first, as it is seen: one is
 * selected, and is what the tools act on. A layer is moved up or down and removed when the
 * image has several; `add` offers what a new layer can be. A PNG is listed as its one layer.
 */
export function LayersPanel({
  rows,
  selected,
  onSelect,
  onMove,
  onRemove,
  add,
  children,
}: {
  /** From the bottom of the stack up. */
  rows: readonly LayerRow[];
  selected: number | null;
  onSelect?: (index: number) => void;
  /** Moves the layer at `index` to `to` in the stack. */
  onMove?: (index: number, to: number) => void;
  onRemove?: (index: number) => void;
  /** What adds a layer; `disabled` when no more can be added now. */
  add?: {
    common: () => void;
    module: () => void;
    drawn: () => void;
    disabled?: boolean;
    /** Said when the button is pointed at. */
    hint?: string;
  };
  /** Under the list: what is said or done about the layers as a whole. */
  children?: ReactNode;
}) {
  const { t } = useTranslation();
  const several = rows.length > 1;
  // The layer whose name is being written, what is written, and why it was refused.
  const [naming, setNaming] = useState<{ index: number; name: string; error?: string } | null>(
    null,
  );
  return (
    <StudioSection title={t("compose.layers")} testId="studio-layers">
      {add ? (
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <Button
              size="sm"
              variant="outline"
              className="self-start"
              disabled={add.disabled}
              title={add.hint}
            >
              <Plus className="size-3.5" />
              {t("compose.addLayer")}
            </Button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="start">
            {(
              [
                ["common", "compose.addKit"],
                ["module", "compose.addImage"],
                ["drawn", "compose.addDrawn"],
              ] as const
            ).map(([kind, label]) => (
              <DropdownMenuItem key={kind} onSelect={add[kind]}>
                {t(label)}
              </DropdownMenuItem>
            ))}
          </DropdownMenuContent>
        </DropdownMenu>
      ) : null}
      <ul className="flex flex-col gap-1">
        {rows
          .slice()
          .reverse()
          .map((row) => {
            const on = selected === row.index;
            return (
              <li
                key={row.index}
                className={cx(
                  "flex items-center gap-1 rounded-[8px] border px-1.5 py-1",
                  on
                    ? "border-[var(--brand)] bg-[var(--brand-soft)]"
                    : "border-[var(--border-soft)] bg-[var(--surface-raised)]",
                )}
              >
                {naming?.index === row.index && row.rename ? (
                  <form
                    className="flex min-w-0 flex-1 flex-col gap-0.5"
                    onSubmit={(event) => {
                      event.preventDefault();
                      const error = row.rename?.(naming.name);
                      setNaming(error ? { ...naming, error } : null);
                    }}
                  >
                    <Input
                      autoFocus
                      className="h-7 font-mono text-xs"
                      aria-label={t("compose.rename.label", { name: row.label })}
                      value={naming.name}
                      onChange={(event) =>
                        setNaming({ index: row.index, name: event.target.value })
                      }
                      onBlur={() => setNaming((held) => (held?.error ? held : null))}
                      onKeyDown={(event) => {
                        if (event.key === "Escape") setNaming(null);
                      }}
                    />
                    {naming.error ? (
                      <span role="alert" className="text-[11px] text-[var(--danger)]">
                        {naming.error}
                      </span>
                    ) : null}
                  </form>
                ) : (
                  <button
                    type="button"
                    className="flex min-w-0 flex-1 cursor-pointer items-center gap-2 border-0 bg-transparent p-0 text-left text-xs text-[var(--text)]"
                    aria-pressed={on}
                    onClick={() => onSelect?.(row.index)}
                  >
                    <Thumb image={row.image} picture={row.picture} />
                    <span className="truncate font-mono">{row.label}</span>
                    {row.repeat ? <span className="badge shrink-0">{row.repeat}</span> : null}
                    {row.common ? (
                      <span className="badge shrink-0">{t("studio.commonLayer")}</span>
                    ) : null}
                    {!row.image ? (
                      <span className="badge badge-amber shrink-0">{t("compose.missing")}</span>
                    ) : null}
                  </button>
                )}
                {row.rename && naming?.index !== row.index ? (
                  <Button
                    size="icon"
                    variant="ghost"
                    className="size-7"
                    aria-label={t("compose.rename.button", { name: row.label })}
                    title={t("compose.rename.button", { name: row.label })}
                    onClick={() => setNaming({ index: row.index, name: row.label })}
                  >
                    <Pencil className="size-3.5" />
                  </Button>
                ) : null}
                {onMove && several ? (
                  <>
                    <Button
                      size="icon"
                      variant="ghost"
                      className="size-7"
                      aria-label={t("compose.up", { name: row.label })}
                      disabled={row.index === rows.length - 1}
                      onClick={() => onMove(row.index, row.index + 1)}
                    >
                      <ArrowUp className="size-3.5" />
                    </Button>
                    <Button
                      size="icon"
                      variant="ghost"
                      className="size-7"
                      aria-label={t("compose.down", { name: row.label })}
                      disabled={row.index === 0}
                      onClick={() => onMove(row.index, row.index - 1)}
                    >
                      <ArrowDown className="size-3.5" />
                    </Button>
                  </>
                ) : null}
                {onRemove ? (
                  <Button
                    size="icon"
                    variant="ghost"
                    className="size-7"
                    aria-label={t("compose.remove", { name: row.label })}
                    disabled={!several}
                    onClick={() => onRemove(row.index)}
                  >
                    <Trash2 className="size-3.5" />
                  </Button>
                ) : null}
              </li>
            );
          })}
      </ul>
      {children}
    </StudioSection>
  );
}
