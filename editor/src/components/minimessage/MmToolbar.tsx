import { Popover, PopoverClose, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { Segmented } from "@/components/ui/segmented";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Tooltip } from "@/components/ui/tooltip";
import { MiniMessageInline } from "@/lib/MiniMessageInline";
import { cx } from "@/lib/cx";
import {
  type ClickAction,
  type Decoration,
  clearFormatting,
  removeColor,
  setClick,
  setColor,
  setGradient,
  setHover,
  toggleDecoration,
  wrapWith,
} from "@/lib/mm/edit";
import type { Palette } from "@/lib/mm/palettes";
import { swatchHex } from "@/lib/mm/palettes";
import type { MmFeature, MmProfile } from "@/lib/mm/profiles";
import {
  Bold,
  Check,
  Copy,
  Eraser,
  Italic,
  MessageSquareText,
  MousePointerClick,
  Paintbrush,
  Sparkles,
  Strikethrough,
  Underline,
  Wand2,
} from "lucide-react";
import { type ReactNode, useState } from "react";
import { useTranslation } from "react-i18next";
import type { MmViewMode } from "./mmCodeMirror";
import type { MmOp } from "./pendingFormat";

export type { MmOp };

/**
 * What an operation is, for when nothing is selected and it waits for the next typed
 * text: the same `key` replaces itself (one color), a `toggle` chosen twice cancels.
 */
export interface FormatKey {
  key: string;
  toggle?: boolean;
}

export interface MmToolbarProps {
  profile: MmProfile;
  palettes: Palette[];
  mode: MmViewMode;
  onModeChange: (mode: MmViewMode) => void;
  /** Decorations on over the whole selection, or that typing at the caret would get. */
  active: Partial<Record<Decoration, boolean>>;
  /** Formats chosen with nothing selected, waiting for the next typed text. */
  pending?: ReadonlySet<string>;
  /**
   * Runs `op` on the selection; with nothing selected, keeps it for the next typed text.
   */
  onOp: (op: MmOp, format: FormatKey) => void;
  /** Shown when the text holds legacy codes. */
  onConvertLegacy?: () => void;
  onCopy: () => Promise<void>;
  /** The variables and expressions library, when the text has placeholders to offer. */
  library?: ReactNode;
}

const DECORATIONS: { key: Decoration; icon: typeof Bold }[] = [
  { key: "bold", icon: Bold },
  { key: "italic", icon: Italic },
  { key: "underlined", icon: Underline },
  { key: "strikethrough", icon: Strikethrough },
  { key: "obfuscated", icon: Sparkles },
];

const HEX = /^#[0-9a-f]{6}$/i;
/** Colors and gradients replace one another: one pending color at a time. */
const COLOR: FormatKey = { key: "color" };

function ToolButton({
  label,
  disabled,
  pressed,
  onClick,
  children,
}: {
  label: string;
  disabled?: boolean;
  pressed?: boolean;
  onClick?: () => void;
  children: ReactNode;
}) {
  return (
    <Tooltip content={label}>
      <button
        type="button"
        aria-label={label}
        aria-pressed={pressed}
        aria-disabled={disabled || undefined}
        onClick={disabled ? undefined : onClick}
        className={cx(
          "btn btn-ghost btn-icon btn-sm",
          pressed && "bg-[var(--brand-soft)] text-[var(--brand)]",
          disabled && "opacity-40",
        )}
      >
        {children}
      </button>
    </Tooltip>
  );
}

/**
 * A toolbar button opening a small form. `pending`: what it applies waits for the next
 * typed text, the button shows it.
 */
function ToolPopover({
  label,
  icon,
  pending,
  children,
}: {
  label: string;
  icon: ReactNode;
  pending?: boolean;
  children: ReactNode;
}) {
  return (
    <Popover>
      <Tooltip content={label}>
        <PopoverTrigger asChild>
          <button
            type="button"
            aria-label={label}
            className={cx(
              "btn btn-ghost btn-icon btn-sm",
              pending && "bg-[var(--brand-soft)] text-[var(--brand)]",
            )}
          >
            {icon}
          </button>
        </PopoverTrigger>
      </Tooltip>
      <PopoverContent onOpenAutoFocus={(e) => e.preventDefault()}>{children}</PopoverContent>
    </Popover>
  );
}

function ColorField({
  value,
  onChange,
  label,
}: { value: string; onChange: (v: string) => void; label: string }) {
  return (
    <span className="flex items-center gap-1.5">
      <input
        type="color"
        aria-label={label}
        value={HEX.test(value) ? value : "#ffffff"}
        onChange={(e) => onChange(e.target.value)}
        className="size-7 cursor-pointer rounded border border-[var(--border)] bg-transparent p-0"
      />
      <input
        className="input h-7 w-[92px] font-mono text-xs"
        aria-label={label}
        value={value}
        onChange={(e) => onChange(e.target.value.trim())}
      />
    </span>
  );
}

export function MmToolbar({
  profile,
  palettes,
  mode,
  onModeChange,
  active,
  pending,
  onOp,
  onConvertLegacy,
  onCopy,
  library,
}: MmToolbarProps) {
  const { t } = useTranslation();
  const has = (f: MmFeature) => profile.features.has(f);
  const waiting = (key: string) => pending?.has(key) ?? false;
  const [custom, setCustom] = useState("#5ab4ff");
  const [gradFrom, setGradFrom] = useState("#ff5f6d");
  const [gradTo, setGradTo] = useState("#ffc371");
  const [clickAction, setClickAction] = useState<ClickAction>("run_command");
  const [clickValue, setClickValue] = useState("");
  const [hoverText, setHoverText] = useState("");
  const [copied, setCopied] = useState(false);
  const styles = palettes.flatMap((p) => p.styles);
  const gradients = palettes.flatMap((p) => p.gradients.map((g) => ({ ...g, paletteId: p.id })));

  return (
    <div
      role="toolbar"
      aria-label={t("mmEditor.toolbar.label")}
      className="flex flex-wrap items-center gap-0.5 border-[var(--border-soft)] border-b px-1.5 py-1"
    >
      {has("decoration") &&
        DECORATIONS.map(({ key, icon: Icon }) => (
          <ToolButton
            key={key}
            label={t(`mmEditor.toolbar.${key}`)}
            pressed={!!active[key]}
            onClick={() =>
              onOp((s, f, to, pl) => toggleDecoration(s, f, to, key, pl), { key, toggle: true })
            }
          >
            <Icon className="size-4" />
          </ToolButton>
        ))}

      {(has("color") || has("gradient")) && (
        <ToolPopover
          label={t("mmEditor.toolbar.color")}
          icon={<Paintbrush className="size-4" />}
          pending={waiting("color")}
        >
          <Tabs defaultValue={has("color") ? "color" : "gradient"} className="flex flex-col gap-3">
            {has("color") && has("gradient") && (
              <TabsList aria-label={t("mmEditor.toolbar.color")}>
                <TabsTrigger value="color">{t("mmEditor.color.tab")}</TabsTrigger>
                <TabsTrigger value="gradient">{t("mmEditor.gradient.tab")}</TabsTrigger>
              </TabsList>
            )}
            <TabsContent value="color" className="flex flex-col gap-3">
              {palettes
                .filter((p) => p.swatches.length > 0)
                .map((p) => (
                  <div key={p.id} className="flex flex-col gap-1.5">
                    <span className="field-label">{p.name}</span>
                    <div className="flex flex-wrap gap-1">
                      {p.swatches.map((s) => (
                        <PopoverClose asChild key={s.id}>
                          <button
                            type="button"
                            aria-label={s.name}
                            title={s.name}
                            onClick={() =>
                              onOp((src, f, to, pl) => setColor(src, f, to, s.color, pl), COLOR)
                            }
                            className="size-6 rounded border border-[var(--border)] transition-transform hover:scale-110"
                            style={{ background: swatchHex(s.color) }}
                          />
                        </PopoverClose>
                      ))}
                    </div>
                  </div>
                ))}
              <div className="flex flex-col gap-1.5">
                <span className="field-label">{t("mmEditor.color.custom")}</span>
                <div className="flex items-center justify-between gap-2">
                  <ColorField
                    value={custom}
                    onChange={setCustom}
                    label={t("mmEditor.color.custom")}
                  />
                  <PopoverClose asChild>
                    <button
                      type="button"
                      className="btn btn-primary btn-sm"
                      disabled={!HEX.test(custom)}
                      onClick={() =>
                        onOp((src, f, to, pl) => setColor(src, f, to, custom, pl), COLOR)
                      }
                    >
                      {t("mmEditor.color.apply")}
                    </button>
                  </PopoverClose>
                </div>
              </div>
            </TabsContent>
            <TabsContent value="gradient" className="flex flex-col gap-3">
              {gradients.length > 0 && (
                <div className="grid grid-cols-2 gap-1.5">
                  {gradients.map((g) => (
                    <PopoverClose asChild key={`${g.paletteId}:${g.id}`}>
                      <button
                        type="button"
                        onClick={() =>
                          onOp(
                            (src, f, to, pl) => setGradient(src, f, to, g.stops, pl, g.phase),
                            COLOR,
                          )
                        }
                        className="flex items-center gap-2 rounded-[var(--r-xs)] border border-[var(--border-soft)] px-2 py-1 text-left text-xs hover:bg-[var(--surface-hover)]"
                      >
                        <span
                          aria-hidden
                          className="h-3 w-8 shrink-0 rounded-sm"
                          style={{
                            background: `linear-gradient(to right, ${g.stops.map(swatchHex).join(", ")})`,
                          }}
                        />
                        <span className="truncate">{g.name}</span>
                      </button>
                    </PopoverClose>
                  ))}
                </div>
              )}
              <div className="flex flex-col gap-1.5">
                <span className="field-label">{t("mmEditor.gradient.custom")}</span>
                <ColorField
                  value={gradFrom}
                  onChange={setGradFrom}
                  label={t("mmEditor.gradient.custom")}
                />
                <ColorField
                  value={gradTo}
                  onChange={setGradTo}
                  label={t("mmEditor.gradient.custom")}
                />
                <PopoverClose asChild>
                  <button
                    type="button"
                    className="btn btn-primary btn-sm self-end"
                    disabled={!HEX.test(gradFrom) || !HEX.test(gradTo)}
                    onClick={() =>
                      onOp(
                        (src, f, to, pl) => setGradient(src, f, to, [gradFrom, gradTo], pl),
                        COLOR,
                      )
                    }
                  >
                    {t("mmEditor.gradient.apply")}
                  </button>
                </PopoverClose>
              </div>
            </TabsContent>
            <PopoverClose asChild>
              <button
                type="button"
                className="btn btn-ghost btn-sm self-start"
                onClick={() => onOp(removeColor, COLOR)}
              >
                {t("mmEditor.color.remove")}
              </button>
            </PopoverClose>
          </Tabs>
        </ToolPopover>
      )}

      {has("color") && (
        <ToolPopover
          label={t("mmEditor.toolbar.styles")}
          icon={<Wand2 className="size-4" />}
          pending={waiting("style")}
        >
          {styles.length === 0 ? (
            <p className="text-[var(--text-mut)]">{t("mmEditor.styles.empty")}</p>
          ) : (
            <div className="flex flex-col gap-1">
              {styles.map((s) => (
                <PopoverClose asChild key={s.id}>
                  <button
                    type="button"
                    onClick={() =>
                      onOp((src, f, to, pl) => wrapWith(src, f, to, s.open, s.close, pl), {
                        key: "style",
                      })
                    }
                    className="rounded-[var(--r-xs)] px-2 py-1 text-left hover:bg-[var(--surface-hover)]"
                  >
                    <MiniMessageInline
                      source={`${s.open}${s.name}${s.close}`}
                      className="mc-text"
                    />
                  </button>
                </PopoverClose>
              ))}
            </div>
          )}
        </ToolPopover>
      )}

      {has("click") && (
        <ToolPopover
          label={t("mmEditor.toolbar.click")}
          icon={<MousePointerClick className="size-4" />}
          pending={waiting("click")}
        >
          <div className="flex flex-col gap-2">
            <label className="flex flex-col gap-1">
              <span className="field-label">{t("mmEditor.click.action")}</span>
              <select
                className="input h-8"
                value={clickAction}
                onChange={(e) => setClickAction(e.target.value as ClickAction)}
              >
                {(["run_command", "suggest_command", "open_url", "copy_to_clipboard"] as const).map(
                  (a) => (
                    <option key={a} value={a}>
                      {t(`mmEditor.click.actions.${a}`)}
                    </option>
                  ),
                )}
              </select>
            </label>
            <label className="flex flex-col gap-1">
              <span className="field-label">{t("mmEditor.click.value")}</span>
              <input
                className="input h-8 font-mono text-xs"
                value={clickValue}
                placeholder={clickAction === "open_url" ? "https://" : "/spawn"}
                onChange={(e) => setClickValue(e.target.value)}
              />
            </label>
            <PopoverClose asChild>
              <button
                type="button"
                className="btn btn-primary btn-sm self-end"
                disabled={!clickValue}
                onClick={() =>
                  onOp((src, f, to, pl) => setClick(src, f, to, clickAction, clickValue, pl), {
                    key: "click",
                  })
                }
              >
                {t("mmEditor.click.apply")}
              </button>
            </PopoverClose>
          </div>
        </ToolPopover>
      )}

      {has("hover") && (
        <ToolPopover
          label={t("mmEditor.toolbar.hover")}
          icon={<MessageSquareText className="size-4" />}
          pending={waiting("hover")}
        >
          <div className="flex flex-col gap-2">
            <label className="flex flex-col gap-1">
              <span className="field-label">{t("mmEditor.hover.text")}</span>
              <textarea
                className="textarea font-mono text-xs"
                rows={3}
                value={hoverText}
                onChange={(e) => setHoverText(e.target.value)}
              />
            </label>
            <PopoverClose asChild>
              <button
                type="button"
                className="btn btn-primary btn-sm self-end"
                disabled={!hoverText}
                onClick={() =>
                  onOp((src, f, to, pl) => setHover(src, f, to, hoverText, pl), { key: "hover" })
                }
              >
                {t("mmEditor.hover.apply")}
              </button>
            </PopoverClose>
          </div>
        </ToolPopover>
      )}

      <ToolButton
        label={t("mmEditor.toolbar.clear")}
        pressed={waiting("clear")}
        onClick={() => onOp(clearFormatting, { key: "clear" })}
      >
        <Eraser className="size-4" />
      </ToolButton>

      {library}

      {onConvertLegacy && (
        <Tooltip content={t("mmEditor.toolbar.legacyHint")}>
          <button type="button" className="btn btn-outline btn-sm ml-1" onClick={onConvertLegacy}>
            {t("mmEditor.toolbar.legacy")}
          </button>
        </Tooltip>
      )}

      <span className="ml-auto flex items-center gap-1.5">
        <ToolButton
          label={copied ? t("mmEditor.toolbar.copied") : t("mmEditor.toolbar.copy")}
          onClick={() => {
            void onCopy().then(() => {
              setCopied(true);
              setTimeout(() => setCopied(false), 1500);
            });
          }}
        >
          {copied ? <Check className="size-4" /> : <Copy className="size-4" />}
        </ToolButton>
        <Segmented
          label={t("mmEditor.mode.label")}
          value={mode}
          onChange={onModeChange}
          options={[
            { value: "rich", label: t("mmEditor.mode.rich") },
            { value: "code", label: t("mmEditor.mode.code") },
          ]}
        />
      </span>
    </div>
  );
}
