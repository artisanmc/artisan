import { Button } from "@/components/ui/button";
import { useTourPresentation } from "@/features/onboarding/tourPresentation";
import { useIsDesktop } from "@/lib/useMediaQuery";
import { useSidebarStore } from "@/state/sidebarStore";
import { PanelLeftClose, PanelLeftOpen, X } from "lucide-react";
import { type ReactNode, useCallback, useEffect, useRef, useState } from "react";
import { useTranslation } from "react-i18next";

const hasPopup = () => !!document.querySelector('[role="menu"], [role="dialog"], [role="listbox"]');

export function NavigationSidebar({ children }: { children: ReactNode }) {
  const { t } = useTranslation();
  const desktop = useIsDesktop();
  const tourStep = useTourPresentation((s) => s.step);
  const { pinned, togglePinned, isOpen, open, close } = useSidebarStore();
  const [revealed, setRevealed] = useState(false);
  const panel = useRef<HTMLElement>(null);
  const toggle = useRef<HTMLButtonElement>(null);
  const hovered = useRef(false);
  const keyboard = useRef(false);
  const restoreFocus = useRef(false);
  const timer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  const visible = tourStep === 1 || (desktop ? pinned || revealed : isOpen);
  const cancelClose = useCallback(() => {
    clearTimeout(timer.current);
    timer.current = undefined;
  }, []);
  useEffect(() => cancelClose, [cancelClose]);
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
  useEffect(() => {
    if (!visible) {
      if (restoreFocus.current) toggle.current?.focus();
      restoreFocus.current = false;
      return;
    }
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Tab") keyboard.current = true;
      if (event.key !== "Escape" || event.defaultPrevented || hasPopup() || (desktop && pinned))
        return;
      event.preventDefault();
      restoreFocus.current = true;
      setRevealed(false);
      close();
    };
    const onPointer = () => {
      keyboard.current = false;
    };
    const onFocus = () => {
      if (!hovered.current && timer.current === undefined) scheduleClose();
    };
    // Radix menus are portalled outside the sidebar; wait for their dismissal.
    const observer = new MutationObserver(onFocus);
    observer.observe(document.body, { childList: true, subtree: true });
    window.addEventListener("keydown", onKey);
    window.addEventListener("pointerdown", onPointer);
    document.addEventListener("focusin", onFocus);
    return () => {
      cancelClose();
      observer.disconnect();
      window.removeEventListener("keydown", onKey);
      window.removeEventListener("pointerdown", onPointer);
      document.removeEventListener("focusin", onFocus);
    };
  }, [visible, desktop, pinned, close, cancelClose, scheduleClose]);
  const buttonLabel = pinned
    ? t("navigation.close", "Close navigation")
    : t("navigation.open", "Open navigation");
  return (
    <>
      <div
        data-testid="navigation-space"
        data-pinned={pinned}
        className={`hidden shrink-0 transition-[width] duration-200 ease-out motion-reduce:transition-none lg:block ${pinned ? "w-[264px]" : "w-0"}`}
      />
      {desktop && !pinned && (
        <div
          data-testid="navigation-edge"
          className="fixed inset-y-0 left-0 z-40 w-2"
          onMouseEnter={() => {
            hovered.current = true;
            cancelClose();
            setRevealed(true);
          }}
          onMouseLeave={() => {
            hovered.current = false;
            scheduleClose();
          }}
        />
      )}
      {!desktop && isOpen && (
        <button
          type="button"
          tabIndex={-1}
          aria-label={t("navigation.dismiss", "Dismiss navigation")}
          className="fixed inset-0 z-40 bg-[var(--surface)]/80"
          onClick={close}
        />
      )}
      <aside
        ref={panel}
        id="global-navigation"
        data-tour="navigation"
        data-testid="navigation-sidebar"
        inert={!visible}
        aria-hidden={!visible}
        aria-label={t("navigation.label", "Main navigation")}
        onMouseEnter={() => {
          if (desktop) {
            hovered.current = true;
            cancelClose();
          }
        }}
        onMouseLeave={() => {
          hovered.current = false;
          scheduleClose();
        }}
        className={`fixed z-50 flex w-[264px] flex-col overflow-hidden bg-[var(--surface)] transition-transform duration-200 motion-reduce:transition-none ${desktop && pinned ? "inset-y-0 left-0" : "inset-y-2 left-2 rounded-[var(--r-lg)] ring-1 ring-inset ring-[var(--border)]"} ${visible ? `translate-x-0 ${desktop && pinned ? "" : "shadow-[var(--shadow-lg)]"}` : "-translate-x-[calc(100%+8px)]"}`}
      >
        {!desktop && (
          <div className="absolute right-2 top-3 z-10">
            <Button
              variant="ghost"
              size="icon"
              title={t("navigation.close", "Close navigation")}
              aria-label={t("navigation.close", "Close navigation")}
              onClick={close}
            >
              <X size={16} />
            </Button>
          </div>
        )}
        <div
          className={`min-h-0 flex-1 ${desktop ? "[&>nav>a:first-child]:pl-11" : ""} ${desktop && pinned ? "" : "[&>nav]:pt-0"}`}
        >
          {children}
        </div>
      </aside>
      <Button
        ref={toggle}
        data-tour="navigation-trigger"
        variant="ghost"
        size="icon"
        type="button"
        aria-controls="global-navigation"
        aria-hidden={!desktop && visible}
        tabIndex={!desktop && visible ? -1 : 0}
        aria-expanded={visible}
        aria-label={desktop ? buttonLabel : t("navigation.open", "Open navigation")}
        title={desktop ? buttonLabel : t("navigation.open", "Open navigation")}
        className={`fixed left-3 top-2 z-50 size-11 lg:top-3.5 lg:size-9 rounded-[var(--r-md)] border border-[var(--border)] bg-[var(--surface-raised)] shadow-[var(--shadow-md)] ${!desktop && visible ? "invisible" : ""}`}
        onClick={
          desktop
            ? () => {
                cancelClose();
                hovered.current = false;
                setRevealed(false);
                togglePinned();
              }
            : open
        }
      >
        {desktop && pinned ? <PanelLeftClose size={16} /> : <PanelLeftOpen size={16} />}
      </Button>
    </>
  );
}
