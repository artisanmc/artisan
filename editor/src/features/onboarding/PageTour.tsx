import { GuidedTour } from "@/components/ui/guided-tour";
import type { PageTourProps } from "@artisan/editor-sdk";
import { useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import { visibleTarget } from "./tourTargets";

/**
 * A page's own tour (SDK 1.19), started on demand: the editor's `GuidedTour` over the steps a
 * module gives, each pointing at its `[data-tour="…"]` element. A step whose element is off screen
 * scrolls it into view; one whose element is not there shows centred. Nothing is saved: the tour
 * is told again each time it is opened.
 */
export function PageTour({ open, steps, onClose }: PageTourProps) {
  const { t } = useTranslation();
  const [step, setStep] = useState(0);
  const [target, setTarget] = useState<HTMLElement | null>(null);
  useEffect(() => {
    if (open) setStep(0);
  }, [open]);
  const at = Math.min(step, Math.max(0, steps.length - 1));
  const name = steps[at]?.target;
  useEffect(() => {
    setTarget(null);
    if (!open || !name) return;
    const element = document.querySelector<HTMLElement>(`[data-tour="${CSS.escape(name)}"]`);
    if (element && !visibleTarget([name])) element.scrollIntoView?.({ block: "center" });
    const measure = () => setTarget(visibleTarget([name]));
    const settled = window.setTimeout(measure, 120);
    window.addEventListener("resize", measure);
    return () => {
      clearTimeout(settled);
      window.removeEventListener("resize", measure);
    };
  }, [open, name]);
  if (steps.length === 0) return null;
  const last = at === steps.length - 1;
  return (
    <GuidedTour
      open={open}
      target={target}
      title={steps[at]!.title}
      description={steps[at]!.description}
      step={at + 1}
      totalSteps={steps.length}
      labels={{
        next: t(last ? "onboarding.finish" : "onboarding.next"),
        previous: t("onboarding.previous"),
        defer: t("onboarding.close"),
        progress: t("onboarding.progress", { step: at + 1, total: steps.length }),
      }}
      onNext={() => (last ? onClose() : setStep(at + 1))}
      onPrevious={at > 0 ? () => setStep(at - 1) : undefined}
      onDefer={onClose}
    />
  );
}
