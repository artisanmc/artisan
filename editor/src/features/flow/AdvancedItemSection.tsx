import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Collapsible } from "@/components/ui/collapsible";
import { Input } from "@/components/ui/input";
import {
  type AdvancedFields,
  ENCHANTMENTS,
  HIDE_FLAGS,
  type ItemEnchant,
  type ItemHideFlag,
  clampEnchantLevel,
  countAdvanced,
  enchantMaxLevel,
  isColorable,
  normalizeEnchantId,
} from "@/domain/itemAdvanced";
import { Plus, X } from "lucide-react";
import { useId } from "react";
import { useTranslation } from "react-i18next";

function FieldLabel({ children }: { children: React.ReactNode }) {
  return (
    <div className="mb-1 font-mono text-[10px] text-[var(--text-faint)] uppercase">{children}</div>
  );
}

/**
 * The "advanced parameters" tail of an item form: enchantments, glint, custom
 * model data, unbreakable, hidden tooltip sections, tint, raw NBT.
 *
 * Collapsed by default — these are the fields most menus never touch — with a
 * count badge so a configured item doesn't hide its own configuration.
 */
export function AdvancedItemSection({
  appearance,
  material,
  onChange,
  onFocus,
}: {
  appearance: AdvancedFields;
  /** Drives which fields are relevant (a tint only applies to some materials). */
  material?: string;
  onChange: (patch: AdvancedFields) => void;
  onFocus?: () => void;
}) {
  const { t } = useTranslation();
  const listId = useId();
  const enchants = appearance.enchants ?? [];
  const hide = appearance.hide ?? [];
  const configured = countAdvanced(appearance);
  const colorable = isColorable(material);

  function patchEnchants(next: ItemEnchant[]) {
    onFocus?.();
    onChange({ enchants: next.length > 0 ? next : undefined });
  }

  function setEnchant(index: number, patch: Partial<ItemEnchant>) {
    patchEnchants(enchants.map((e, i) => (i === index ? { ...e, ...patch } : e)));
  }

  function toggleHide(flag: ItemHideFlag) {
    const next = hide.includes(flag) ? hide.filter((f) => f !== flag) : [...hide, flag];
    onFocus?.();
    onChange({ hide: next.length > 0 ? next : undefined });
  }

  return (
    <Collapsible
      title={t("flow.advanced.title")}
      meta={configured > 0 ? <Badge variant="sage">{configured}</Badge> : null}
    >
      <div className="flex flex-col gap-3">
        {/* Enchantments */}
        <div>
          <FieldLabel>{t("flow.advanced.enchants")}</FieldLabel>
          <datalist id={listId}>
            {ENCHANTMENTS.map((e) => (
              <option key={e.id} value={e.id} />
            ))}
          </datalist>
          <div className="flex flex-col gap-1">
            {enchants.map((ench, i) => {
              const max = enchantMaxLevel(ench.id);
              const overMax = max !== undefined && ench.level > max;
              return (
                <div
                  // biome-ignore lint/suspicious/noArrayIndexKey: rows are positional, ids may repeat while typing
                  key={i}
                  className="flex items-center gap-1"
                >
                  {/* Widths live on the wrappers, never on the Input: `.input`
                      sets width:100% in globals.css and wins over a Tailwind
                      width utility at equal specificity. */}
                  <div className="min-w-0 flex-1">
                    <Input
                      list={listId}
                      value={ench.id}
                      placeholder={t("flow.advanced.enchantPlaceholder")}
                      onChange={(e) => setEnchant(i, { id: normalizeEnchantId(e.target.value) })}
                      onFocus={onFocus}
                      className="h-7 px-2 py-0 font-mono text-xs"
                    />
                  </div>
                  <div className="w-14 shrink-0">
                    <Input
                      type="number"
                      min={1}
                      value={ench.level}
                      title={
                        overMax
                          ? t("flow.advanced.enchantOverMax", { max, id: ench.id })
                          : undefined
                      }
                      onChange={(e) =>
                        setEnchant(i, { level: clampEnchantLevel(ench.id, Number(e.target.value)) })
                      }
                      onFocus={onFocus}
                      className={`h-7 px-1.5 py-0 text-center text-xs ${
                        overMax ? "text-[var(--warning)]" : ""
                      }`}
                    />
                  </div>
                  <Button
                    variant="ghost"
                    size="icon"
                    aria-label={t("flow.advanced.enchantRemove")}
                    title={t("flow.advanced.enchantRemove")}
                    onClick={() => patchEnchants(enchants.filter((_, j) => j !== i))}
                    className="h-7 w-7 shrink-0"
                  >
                    <X size={12} />
                  </Button>
                </div>
              );
            })}
            <Button
              variant="ghost"
              size="sm"
              onClick={() => patchEnchants([...enchants, { id: "", level: 1 }])}
              className="h-7 justify-start px-1 text-xs"
            >
              <Plus size={12} className="mr-1" />
              {t("flow.advanced.enchantAdd")}
            </Button>
          </div>
        </div>

        {/* Glint — only meaningful without real enchantments, which already glint. */}
        {enchants.length === 0 ? (
          <label className="flex items-center gap-2 text-xs text-[var(--text-mut)]">
            <input
              type="checkbox"
              checked={appearance.enchanted ?? false}
              onChange={(e) => {
                onFocus?.();
                onChange({ enchanted: e.target.checked ? true : undefined });
              }}
            />
            {t("flow.advanced.glint")}
          </label>
        ) : null}

        {/* Custom model data */}
        <div>
          <FieldLabel>{t("flow.advanced.customModelData")}</FieldLabel>
          <Input
            value={appearance.customModelData ?? ""}
            placeholder="1001"
            onChange={(e) => {
              onFocus?.();
              onChange({ customModelData: e.target.value || undefined });
            }}
            onFocus={onFocus}
            className="h-7 px-2 py-0 font-mono text-xs"
          />
        </div>

        {/* Unbreakable */}
        <label className="flex items-center gap-2 text-xs text-[var(--text-mut)]">
          <input
            type="checkbox"
            checked={appearance.unbreakable ?? false}
            onChange={(e) => {
              onFocus?.();
              onChange({ unbreakable: e.target.checked ? true : undefined });
            }}
          />
          {t("flow.advanced.unbreakable")}
        </label>

        {/* Hidden tooltip sections */}
        <div>
          <FieldLabel>{t("flow.advanced.hide")}</FieldLabel>
          <div className="flex flex-wrap gap-1">
            {HIDE_FLAGS.map((flag) => {
              const on = hide.includes(flag);
              return (
                <button
                  key={flag}
                  type="button"
                  onClick={() => toggleHide(flag)}
                  aria-pressed={on}
                  className={`chip text-[11px] ${on ? "" : "opacity-50"}`}
                >
                  {t(`flow.advanced.hideFlags.${flag}`)}
                </button>
              );
            })}
          </div>
        </div>

        {/* Tint — leather armor, potions, firework stars only */}
        {colorable ? (
          <div>
            <FieldLabel>{t("flow.advanced.color")}</FieldLabel>
            <div className="flex items-center gap-2">
              <input
                type="color"
                value={appearance.color ?? "#ffffff"}
                onChange={(e) => {
                  onFocus?.();
                  onChange({ color: e.target.value.toLowerCase() });
                }}
                className="h-7 w-10 shrink-0 rounded border border-[var(--border-soft)] bg-transparent"
              />
              <div className="min-w-0 flex-1">
                <Input
                  value={appearance.color ?? ""}
                  placeholder="#a06540"
                  onChange={(e) => {
                    onFocus?.();
                    onChange({ color: e.target.value || undefined });
                  }}
                  onFocus={onFocus}
                  className="h-7 px-2 py-0 font-mono text-xs"
                />
              </div>
              {appearance.color ? (
                <Button
                  variant="ghost"
                  size="icon"
                  aria-label={t("flow.advanced.colorClear")}
                  title={t("flow.advanced.colorClear")}
                  onClick={() => {
                    onFocus?.();
                    onChange({ color: undefined });
                  }}
                  className="h-7 w-7 shrink-0"
                >
                  <X size={12} />
                </Button>
              ) : null}
            </div>
          </div>
        ) : null}

        {/* Raw NBT escape hatch */}
        <div>
          <FieldLabel>{t("flow.advanced.nbt")}</FieldLabel>
          <textarea
            value={appearance.nbt ?? ""}
            placeholder="{CustomData:{key:1b}}"
            rows={2}
            onChange={(e) => {
              onFocus?.();
              onChange({ nbt: e.target.value || undefined });
            }}
            onFocus={onFocus}
            className="input min-h-0 w-full px-2 py-1 font-mono text-xs"
          />
          <p className="mt-1 text-[10px] text-[var(--text-faint)]">{t("flow.advanced.nbtHint")}</p>
        </div>
      </div>
    </Collapsible>
  );
}
