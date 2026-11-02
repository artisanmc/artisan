import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import type { ProjectId, Step } from "@/domain/types";
import { SHOW_DEFAULT, SHOW_VARIANT, variantNames } from "@/domain/variants";
import { StepTree } from "@/features/inspector/chain/StepTree";
import { controlledChainOps } from "@/features/inspector/chain/chainOps";
import { type ChainVocabulary, ChainVocabularyProvider } from "@/lib/actions/chainVocabulary";
import { useProjectsStore } from "@/state/projectsStore";
import { useEffect, useMemo, useState } from "react";
import { useTranslation } from "react-i18next";

/**
 * The display rules of `variants.yml` (design `variantes-modules` §9): one tree, edited with
 * the action chains' step tree, whose actions are "Show variant X" and "Show Default"; it ends
 * on a fixed "Otherwise: show Default". Saved on "Done", in one undo step.
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
  const [show, setShow] = useState<Step[]>([]);
  useEffect(() => {
    if (open) setShow(project?.variants?.show ?? []);
  }, [open, project?.variants?.show]);
  const names = project ? variantNames(project) : [];
  const namesKey = names.join("\n");
  // biome-ignore lint/correctness/useExhaustiveDependencies: `names` is read through its key.
  const vocabulary = useMemo<ChainVocabulary>(
    () => ({
      actions: [
        {
          name: SHOW_VARIANT,
          args: [
            {
              name: "variant",
              label: t("variants.variant"),
              type: { kind: "enum", values: names },
              required: true,
              ...(names[0] ? { default: names[0] } : {}),
            },
          ],
          primary: "variant",
          moduleId: null,
        },
        { name: SHOW_DEFAULT, args: [], primary: null, moduleId: null },
      ],
      label: (name) =>
        name === SHOW_VARIANT
          ? t("variants.showVariantStep")
          : name === SHOW_DEFAULT
            ? t("variants.showDefaultStep")
            : name,
    }),
    [namesKey, t],
  );
  if (!project) return null;
  const save = () => {
    useProjectsStore.getState().setVariantShow(projectId, show);
    onOpenChange(false);
  };
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-h-[85vh] max-w-2xl overflow-y-auto">
        <DialogHeader>
          <DialogTitle>{t("variants.rulesTitle")}</DialogTitle>
          <DialogDescription>{t("variants.rulesHint")}</DialogDescription>
        </DialogHeader>
        {names.length === 0 ? (
          <p className="text-sm text-[var(--text-mut)]">{t("variants.rulesEmpty")}</p>
        ) : (
          <ChainVocabularyProvider value={vocabulary}>
            <div className="flex flex-col gap-1.5">
              <StepTree
                projectId={projectId}
                ops={controlledChainOps(show, setShow)}
                steps={show}
                frames={[]}
                indent={0}
                literalText
              />
              {/* What every player gets when nothing above showed a variant: not removable. */}
              <div
                data-testid="variant-rules-default"
                className="flex min-h-[40px] items-center gap-2.5 rounded-[var(--r-sm)] border border-[var(--border-soft)] border-dashed px-2"
                title={t("variants.otherwiseDefaultHint")}
              >
                <span className="shrink-0 rounded-[5px] bg-[var(--fam-logic-soft)] px-2 py-[3px] font-mono text-[11.5px] font-semibold uppercase tracking-[.04em] text-[var(--fam-logic)]">
                  {t("variants.otherwise")}
                </span>
                <span className="text-[13px] font-semibold text-[var(--text)]">
                  {t("variants.showDefaultStep")}
                </span>
              </div>
            </div>
          </ChainVocabularyProvider>
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
