import { GuidedTour } from "@/components/ui/guided-tour";
import { useEffect, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { useTourPresentation } from "./tourPresentation";

interface EditorTourProps {
  state: { open: boolean; step: number; busy: boolean };
  demo: boolean;
  storage?: string;
  canUseAssistant?: boolean;
  actions: {
    next: () => unknown;
    back: () => unknown;
    defer: () => unknown;
    complete: () => unknown;
  };
}

function hasPriorityDialog() {
  return !!document.querySelector('[role="dialog"]:not([data-guided-tour]), [role="alertdialog"]');
}

function visibleTarget(names: string[]) {
  for (const name of names) {
    for (const element of document.querySelectorAll<HTMLElement>(`[data-tour="${name}"]`)) {
      const rect = element.getBoundingClientRect();
      if (
        !element.closest("[hidden], [inert]") &&
        getComputedStyle(element).visibility !== "hidden" &&
        rect.width > 0 &&
        rect.height > 0 &&
        rect.right > 0 &&
        rect.bottom > 0 &&
        rect.left < window.innerWidth &&
        rect.top < window.innerHeight
      )
        return element;
    }
  }
  return null;
}

export function EditorTour({
  state,
  demo,
  storage,
  canUseAssistant = true,
  actions,
}: EditorTourProps) {
  const { t } = useTranslation();
  const [blocked, setBlocked] = useState(hasPriorityDialog);
  const [target, setTarget] = useState<HTMLElement | null>(null);
  const previousStep = useRef(state.step);
  const actionsRef = useRef(actions);
  actionsRef.current = actions;
  const visible = state.open && !blocked;
  useEffect(() => {
    const inspect = () => setBlocked(hasPriorityDialog());
    const observer = new MutationObserver(inspect);
    observer.observe(document.body, { childList: true, subtree: true });
    inspect();
    return () => observer.disconnect();
  }, []);
  useEffect(() => {
    useTourPresentation.setState({ step: visible ? state.step : null });
    return () => useTourPresentation.setState({ step: null });
  }, [visible, state.step]);
  useEffect(() => {
    setTarget(null);
    if (!visible || state.step === 0) return;
    const backwards = state.step < previousStep.current;
    previousStep.current = state.step;
    const selectors = [
      [],
      demo ? ["demo-intro"] : ["navigation", "navigation-trigger"],
      ["canvas"],
      ["library", "library-trigger"],
      // Les Documents du project ouvert, dans la barre de gauche ; repliée,
      // on montre le bouton qui l'ouvre.
      ["elements", "navigation-trigger"],
      ["tabs"],
      demo ? ["demo-export"] : storage === "local" ? ["project-menu"] : ["save", "project-menu"],
    ];
    const measure = () => setTarget(visibleTarget(selectors[state.step] ?? []));
    const settled = window.setTimeout(measure, 260);
    const unavailable = window.setTimeout(() => {
      const found = visibleTarget(selectors[state.step] ?? []);
      setTarget(found);
      if (!found) {
        if (backwards) void actionsRef.current.back();
        else if (state.step < 6) void actionsRef.current.next();
      }
    }, 700);
    window.addEventListener("resize", measure);
    return () => {
      clearTimeout(settled);
      clearTimeout(unavailable);
      window.removeEventListener("resize", measure);
    };
  }, [visible, state.step, demo, storage]);

  const contents = [
    ["welcomeTitle", "welcomeDescription"],
    demo ? ["demoTitle", "demoDescription"] : ["navigationTitle", "navigationDescription"],
    ["canvasTitle", "canvasDescription"],
    ["libraryTitle", "libraryDescription"],
    ["elementsTitle", "elementsDescription"],
    ["tabsTitle", canUseAssistant && !demo ? "tabsDescription" : "tabsDemoDescription"],
    [
      "saveTitle",
      demo
        ? "saveDemoDescription"
        : storage === "local"
            ? "saveLocalDescription"
            : "saveServerDescription",
    ],
  ] as const;
  const [title, description] = contents[state.step] ?? contents[0];
  return (
    <GuidedTour
      open={visible}
      target={target}
      title={t(`onboarding.${title}`)}
      description={t(`onboarding.${description}`)}
      step={state.step}
      totalSteps={6}
      busy={state.busy}
      labels={{
        next: t(`onboarding.${state.step === 0 ? "start" : state.step === 6 ? "finish" : "next"}`),
        previous: t("onboarding.previous"),
        defer: t("onboarding.defer"),
        progress:
          state.step === 0
            ? t("onboarding.duration")
            : t("onboarding.progress", { step: state.step, total: 6 }),
      }}
      onNext={() => {
        void (state.step === 6 ? actions.complete() : actions.next());
      }}
      onPrevious={
        state.step > 1
          ? () => {
              void actions.back();
            }
          : undefined
      }
      onDefer={() => {
        void actions.defer();
      }}
    />
  );
}
