import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Segmented } from "@/components/ui/segmented";
import { Switch } from "@/components/ui/switch";
import type { ProjectId, VariantRule } from "@/domain/types";
import { variantNames } from "@/domain/variants";
import { useProjectsStore } from "@/state/projectsStore";
import { ArrowDown, ArrowUp, Plus, Trash2 } from "lucide-react";
import { useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import { parse, stringify } from "yaml";

type Tri = "any" | "yes" | "no";

/**
 * The display rules of `variants.yml` (design `variantes-modules` §9), edited as a list: order,
 * on/off, the conditions, all required together. Saved on "Done", in one undo step.
 */
export function VariantRulesDialog({
  projectId,
  open,
  onOpenChange,
}: {
  projectId: ProjectId;
  open: boolean;
  onOpenChange: (open: boolean) => void;
}) {
  const { t } = useTranslation();
  const project = useProjectsStore((s) => s.openProjects.projects.find((p) => p.id === projectId));
  const [rules, setRules] = useState<VariantRule[]>([]);
  useEffect(() => {
    if (open) setRules(project?.variants?.rules ?? []);
  }, [open, project?.variants?.rules]);
  if (!project) return null;
  const names = variantNames(project);
  const set = (i: number, patch: Partial<VariantRule>) =>
    setRules((rs) => rs.map((r, j) => (j === i ? { ...r, ...patch } : r)));
  const move = (i: number, by: number) =>
    setRules((rs) => {
      const out = [...rs];
      const [r] = out.splice(i, 1);
      out.splice(i + by, 0, r!);
      return out;
    });
  const versions = (name: string) =>
    Object.values(project.variants?.documents[name] ?? {}).reduce((n, docs) => n + docs.length, 0) +
    (project.variants?.view?.variant === name
      ? Object.values(project.variants.view.shown).reduce((n, ids) => n + ids.length, 0)
      : 0);
  const save = () => {
    useProjectsStore.getState().setVariantRules(projectId, rules);
    onOpenChange(false);
  };
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-h-[85vh] max-w-2xl overflow-y-auto">
        <DialogHeader>
          <DialogTitle>{t("variants.rulesTitle")}</DialogTitle>
          <DialogDescription>{t("variants.rulesHint")}</DialogDescription>
        </DialogHeader>
        {names.length === 0 && (
          <p className="text-sm text-[var(--text-mut)]">{t("variants.rulesEmpty")}</p>
        )}
        <ol className="flex flex-col gap-3">
          {rules.map((rule, i) => (
            <li
              // biome-ignore lint/suspicious/noArrayIndexKey: rules have no stable id while edited
              key={i}
              className="card flex flex-col gap-2 p-3"
            >
              <div className="flex items-center gap-2">
                <span className="eyebrow">{t("variants.rule", { n: i + 1 })}</span>
                <select
                  aria-label={t("variants.variant")}
                  className="input h-8 w-auto"
                  value={rule.variant}
                  onChange={(e) => set(i, { variant: e.target.value })}
                >
                  {names.map((n) => (
                    <option key={n} value={n}>
                      {n}
                    </option>
                  ))}
                </select>
                <span className="ml-auto flex items-center gap-1.5 text-xs text-[var(--text-mut)]">
                  {t("variants.enabled")}
                  <Switch
                    checked={rule.enabled}
                    onCheckedChange={(enabled) => set(i, { enabled })}
                  />
                </span>
                <Button
                  variant="ghost"
                  size="icon"
                  title={t("variants.moveUp")}
                  disabled={i === 0}
                  onClick={() => move(i, -1)}
                >
                  <ArrowUp className="size-4" />
                </Button>
                <Button
                  variant="ghost"
                  size="icon"
                  title={t("variants.moveDown")}
                  disabled={i === rules.length - 1}
                  onClick={() => move(i, 1)}
                >
                  <ArrowDown className="size-4" />
                </Button>
                <Button
                  variant="ghost"
                  size="icon"
                  title={t("variants.removeRule")}
                  onClick={() => setRules((rs) => rs.filter((_, j) => j !== i))}
                >
                  <Trash2 className="size-4" />
                </Button>
              </div>
              <div className="grid grid-cols-[auto_1fr] items-center gap-x-3 gap-y-2 text-sm">
                <span className="field-label">{t("variants.client")}</span>
                <Segmented
                  label={t("variants.client")}
                  value={rule.client ?? "any"}
                  options={[
                    { value: "any", label: t("variants.clientAny") },
                    { value: "java", label: t("variants.clientJava") },
                    { value: "bedrock", label: t("variants.clientBedrock") },
                  ]}
                  onChange={(v) => set(i, { client: v === "any" ? undefined : v })}
                />
                <span className="field-label">{t("variants.hasPack")}</span>
                <Segmented<Tri>
                  label={t("variants.hasPack")}
                  value={rule.hasPack === undefined ? "any" : rule.hasPack ? "yes" : "no"}
                  options={[
                    { value: "any", label: t("variants.hasPackAny") },
                    { value: "yes", label: t("variants.hasPackYes") },
                    { value: "no", label: t("variants.hasPackNo") },
                  ]}
                  onChange={(v) => set(i, { hasPack: v === "any" ? undefined : v === "yes" })}
                />
                <span className="field-label">{t("variants.permission")}</span>
                <Input
                  value={rule.permission ?? ""}
                  placeholder={t("variants.permissionPlaceholder")}
                  onChange={(e) => set(i, { permission: e.target.value.trim() || undefined })}
                />
                <span className="field-label self-start pt-1.5">{t("variants.condition")}</span>
                <ConditionField
                  value={rule.condition}
                  onChange={(condition) => set(i, { condition })}
                />
              </div>
            </li>
          ))}
        </ol>
        {names.length > 0 && (
          <Button
            variant="ghost"
            className="self-start"
            onClick={() => setRules((rs) => [...rs, { variant: names[0]!, enabled: true }])}
          >
            <Plus className="size-4" /> {t("variants.addRule")}
          </Button>
        )}
        {names.length > 0 && (
          <div className="flex flex-wrap gap-2 border-[var(--border)] border-t pt-3">
            {names.map((name) => (
              <Button
                key={name}
                variant="ghost"
                size="sm"
                className="text-[var(--danger)]"
                onClick={() => {
                  const count = versions(name);
                  if (!window.confirm(t("variants.removeVariantConfirm", { name, count }))) return;
                  useProjectsStore.getState().removeVariant(projectId, name);
                  setRules((rs) => rs.filter((r) => r.variant !== name));
                }}
              >
                <Trash2 className="size-4" /> {t("variants.removeVariant", { name })}
              </Button>
            ))}
          </div>
        )}
        <div className="flex justify-end gap-2">
          <Button variant="ghost" onClick={() => onOpenChange(false)}>
            {t("canvas.cancel")}
          </Button>
          <Button onClick={save}>{t("variants.done")}</Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}

/** An engine condition as YAML text: kept as written until it parses. */
function ConditionField({
  value,
  onChange,
}: {
  value: unknown;
  onChange: (value: unknown) => void;
}) {
  const { t } = useTranslation();
  const [text, setText] = useState(() => (value === undefined ? "" : stringify(value).trimEnd()));
  const [invalid, setInvalid] = useState(false);
  return (
    <div className="flex flex-col gap-1">
      <textarea
        className="input min-h-[2.5rem] font-mono text-xs"
        rows={Math.max(1, text.split("\n").length)}
        value={text}
        placeholder="{ type: has_permission, perm: guilds.vip }"
        onChange={(e) => {
          setText(e.target.value);
          if (!e.target.value.trim()) {
            setInvalid(false);
            onChange(undefined);
            return;
          }
          try {
            const parsed = parse(e.target.value);
            setInvalid(false);
            onChange(parsed ?? undefined);
          } catch {
            setInvalid(true);
          }
        }}
      />
      {invalid && (
        <span className="text-xs text-[var(--danger)]">{t("variants.conditionInvalid")}</span>
      )}
    </div>
  );
}
