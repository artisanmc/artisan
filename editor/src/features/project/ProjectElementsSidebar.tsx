import type { ProjectId } from "@/domain/types";
import { useTourPresentation } from "@/features/onboarding/tourPresentation";
import { usePanelPresence } from "@/lib/usePanelPresence";
import { useUiStore } from "@/state/uiStore";
import { useCallback, useEffect, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { ProjectPanel } from "./ProjectPanel";

const hasPopup = () => !!document.querySelector('[role="menu"], [role="dialog"], [role="listbox"]');

export function ProjectElementsSidebar({ projectId }: { projectId: ProjectId }) {
  const { t } = useTranslation();
  const fixed = useUiStore((s) => s.projectPanelOpen);
  const tourStep = useTourPresentation((s) => s.step);
  const [revealed, setRevealed] = useState(false);
  const panel = useRef<HTMLElement>(null);
  const hovered = useRef(false);
  const keyboard = useRef(false);
  const previousFixed = useRef(fixed);
  const timer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  const visible = tourStep === 4 || fixed || revealed;
  const presence = usePanelPresence(visible);
  const cancelClose = useCallback(() => {
    clearTimeout(timer.current);
    timer.current = undefined;
  }, []);
  const scheduleClose = useCallback(() => {
    cancelClose();
    timer.current = setTimeout(() => {
      timer.current = undefined;
      if (
        !hovered.current &&
        !hasPopup() &&
        !(keyboard.current && panel.current?.contains(document.activeElement))
      )
        setRevealed(false);
    }, 300);
  }, [cancelClose]);
  useEffect(() => cancelClose, [cancelClose]);
  useEffect(() => {
    if (previousFixed.current && !fixed) {
      hovered.current = false;
      setRevealed(false);
      cancelClose();
    }
    previousFixed.current = fixed;
  }, [fixed, cancelClose]);
  useEffect(() => {
    if (!visible) return;
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Tab") keyboard.current = true;
      if (event.key !== "Escape" || event.defaultPrevented || fixed || hasPopup()) return;
      event.preventDefault();
      event.stopPropagation();
      hovered.current = false;
      setRevealed(false);
      document.querySelector<HTMLButtonElement>("[data-project-elements-toggle]")?.focus();
    };
    const onPointer = () => {
      keyboard.current = false;
    };
    const checkOutside = () => {
      if (!hovered.current && timer.current === undefined) scheduleClose();
    };
    const observer = new MutationObserver(checkOutside);
    observer.observe(document.body, { childList: true, subtree: true });
    window.addEventListener("keydown", onKey, true);
    window.addEventListener("pointerdown", onPointer);
    document.addEventListener("focusin", checkOutside);
    return () => {
      cancelClose();
      observer.disconnect();
      window.removeEventListener("keydown", onKey, true);
      window.removeEventListener("pointerdown", onPointer);
      document.removeEventListener("focusin", checkOutside);
    };
  }, [visible, fixed, cancelClose, scheduleClose]);
  const enter = () => {
    hovered.current = true;
    cancelClose();
    setRevealed(true);
  };
  const leave = () => {
    hovered.current = false;
    scheduleClose();
  };
  return (
    <>
      <div
        data-testid="project-elements-space"
        data-fixed={fixed}
        className={`shrink-0 transition-[width] duration-200 ease-out motion-reduce:transition-none ${fixed ? "w-[240px]" : "w-0"}`}
      />
      {!fixed && (
        <div
          data-testid="project-elements-edge"
          className="absolute inset-y-0 right-0 z-30 w-2"
          onMouseEnter={enter}
          onMouseLeave={leave}
        />
      )}
      {presence.mounted && (
        <aside
          ref={panel}
          data-testid="project-elements-panel"
          data-tour="elements"
          aria-label={t("projectPanel.openPanel")}
          aria-hidden={!visible}
          inert={!visible}
          style={{
            transform: presence.expanded ? "translateX(0)" : "translateX(calc(100% + 8px))",
            opacity: presence.expanded ? 1 : 0,
          }}
          onMouseEnter={enter}
          onMouseLeave={leave}
          className={`absolute z-30 w-[240px] min-w-0 overflow-hidden bg-[var(--surface)] transition-[transform,opacity] duration-200 ease-out motion-reduce:transition-none ${fixed ? "inset-y-0 right-0 border-l border-[var(--border-soft)]" : "inset-y-2 right-2 rounded-[var(--r-lg)] border border-[var(--border)] shadow-[var(--shadow-lg)]"}`}
        >
          <ProjectPanel projectId={projectId} />
        </aside>
      )}
    </>
  );
}
