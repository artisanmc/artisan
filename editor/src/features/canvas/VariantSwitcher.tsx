import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  DropdownMenu,
  DropdownMenuCheckboxItem,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuRadioGroup,
  DropdownMenuRadioItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Input } from "@/components/ui/input";
import type { ProjectId } from "@/domain/types";
import { VARIANT_NAME, variantNames, viewedVariant } from "@/domain/variants";
import { VariantRulesDialog } from "@/features/project/VariantRulesDialog";
import { useProjectsStore } from "@/state/projectsStore";
import { ChevronDown, Layers, ListOrdered, Lock, Plus } from "lucide-react";
import { useState } from "react";
import { useTranslation } from "react-i18next";

const MODULE = "__module__";

/**
 * "View as" (design `variantes-modules` §9): which variant the canvas shows, a new variant,
 * the display rules. Sits on the canvas toolbar.
 */
export function VariantSwitcher({ projectId }: { projectId: ProjectId }) {
  const { t } = useTranslation();
  const project = useProjectsStore((s) => s.openProjects.projects.find((p) => p.id === projectId));
  const [creating, setCreating] = useState(false);
  const [rulesOpen, setRulesOpen] = useState(false);
  if (!project) return null;
  const names = variantNames(project);
  const original = project.originalView !== undefined;
  const viewed = viewedVariant(project) ?? project.originalView?.variant;
  const store = useProjectsStore.getState();
  return (
    <>
      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <button
            type="button"
            title={t("variants.viewAs")}
            className={`flex h-8 shrink-0 items-center gap-1.5 whitespace-nowrap rounded-[8px] px-2.5 text-[12px] transition-colors ${
              viewed || original
                ? "bg-[var(--brand-soft)] text-[var(--brand)]"
                : "text-[var(--text-mut)] hover:bg-[var(--surface-hover)] hover:text-[var(--text)]"
            }`}
          >
            {original ? (
              <Lock className="size-4 shrink-0" />
            ) : (
              <Layers className="size-4 shrink-0" />
            )}
            <span className="max-w-[16rem] truncate">
              {t(original ? "variants.viewAsOriginal" : "variants.viewAsValue", {
                name: viewed ?? t("variants.module"),
              })}
            </span>
            <ChevronDown className="size-3.5 shrink-0 opacity-60" />
          </button>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="center" side="top" className="w-64">
          <DropdownMenuLabel>{t("variants.viewAs")}</DropdownMenuLabel>
          <DropdownMenuRadioGroup
            value={viewed ?? MODULE}
            onValueChange={(v) => store.showVariant(projectId, v === MODULE ? undefined : v)}
          >
            <DropdownMenuRadioItem value={MODULE} title={t("variants.moduleHint")}>
              {t("variants.module")}
            </DropdownMenuRadioItem>
            {names.map((name) => (
              <DropdownMenuRadioItem key={name} value={name}>
                {name}
              </DropdownMenuRadioItem>
            ))}
          </DropdownMenuRadioGroup>
          {project.originals && (
            <>
              <DropdownMenuSeparator />
              <DropdownMenuCheckboxItem
                checked={original}
                title={t("variants.originalHint")}
                onCheckedChange={(on) => store.showOriginal(projectId, on === true)}
              >
                {t("variants.original")}
              </DropdownMenuCheckboxItem>
            </>
          )}
          <DropdownMenuSeparator />
          <DropdownMenuItem onSelect={() => setCreating(true)} disabled={original}>
            <Plus className="size-4" /> {t("variants.newVariant")}
          </DropdownMenuItem>
          <DropdownMenuItem
            onSelect={() => setRulesOpen(true)}
            disabled={names.length === 0 || original}
          >
            <ListOrdered className="size-4" /> {t("variants.rules")}
          </DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>
      <NewVariantDialog
        open={creating}
        onOpenChange={setCreating}
        taken={names}
        onCreate={(name) => {
          if (store.addVariant(projectId, name)) store.showVariant(projectId, name);
        }}
      />
      <VariantRulesDialog projectId={projectId} open={rulesOpen} onOpenChange={setRulesOpen} />
    </>
  );
}

function NewVariantDialog({
  open,
  onOpenChange,
  taken,
  onCreate,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  taken: string[];
  onCreate: (name: string) => void;
}) {
  const { t } = useTranslation();
  const [name, setName] = useState("");
  const trimmed = name.trim();
  const error = !trimmed
    ? null
    : !VARIANT_NAME.test(trimmed)
      ? t("variants.nameInvalid")
      : taken.includes(trimmed)
        ? t("variants.nameTaken")
        : null;
  const submit = () => {
    if (!trimmed || error) return;
    onCreate(trimmed);
    setName("");
    onOpenChange(false);
  };
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>{t("variants.newVariantTitle")}</DialogTitle>
          <DialogDescription>{t("variants.newVariantHint")}</DialogDescription>
        </DialogHeader>
        <div className="flex flex-col gap-1">
          <Input
            value={name}
            placeholder="textured"
            autoFocus
            onChange={(e) => setName(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter") submit();
            }}
          />
          {error && <span className="text-xs text-[var(--danger)]">{error}</span>}
        </div>
        <div className="flex justify-end gap-2">
          <Button variant="ghost" onClick={() => onOpenChange(false)}>
            {t("canvas.cancel")}
          </Button>
          <Button onClick={submit} disabled={!trimmed || !!error}>
            {t("canvas.create")}
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}
