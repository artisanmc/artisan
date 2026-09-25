import * as Dialog from "@radix-ui/react-dialog";
import { ArrowLeft, ArrowRight } from "lucide-react";
import { useEffect, useLayoutEffect, useRef, useState } from "react";
import { Button } from "./button";

export interface GuidedTourProps {
  open: boolean;
  target?: HTMLElement | null;
  title: string;
  description: string;
  step: number;
  totalSteps: number;
  labels: { next: string; previous: string; defer: string; progress: string };
  busy?: boolean;
  onNext: () => void;
  onPrevious?: () => void;
  onDefer: () => void;
}

export function GuidedTour({
  open,
  target,
  title,
  description,
  step,
  totalSteps,
  labels,
  busy,
  onNext,
  onPrevious,
  onDefer,
}: GuidedTourProps) {
  const content = useRef<HTMLDivElement>(null);
  const returnFocus = useRef<HTMLElement | null>(null);
  const [geometry, setGeometry] = useState({
    width: window.innerWidth,
    height: window.innerHeight,
    cardHeight: 250,
    rect: null as DOMRect | null,
  });
  useLayoutEffect(() => {
    if (open)
      returnFocus.current =
        document.activeElement instanceof HTMLElement ? document.activeElement : null;
  }, [open]);
  useEffect(() => {
    if (!open) return;
    const measure = () =>
      setGeometry({
        width: window.innerWidth,
        height: window.innerHeight,
        cardHeight: content.current?.getBoundingClientRect().height || 250,
        rect: target?.getBoundingClientRect() ?? null,
      });
    measure();
    const observer = new ResizeObserver(measure);
    if (target) observer.observe(target);
    if (content.current) observer.observe(content.current);
    window.addEventListener("resize", measure);
    window.addEventListener("scroll", measure, true);
    document.addEventListener("transitionend", measure, true);
    return () => {
      observer.disconnect();
      window.removeEventListener("resize", measure);
      window.removeEventListener("scroll", measure, true);
      document.removeEventListener("transitionend", measure, true);
    };
  }, [open, target]);

  const { width, height, cardHeight, rect } = geometry;
  const cardWidth = Math.min(360, width - 24);
  const clampLeft = (value: number) => Math.max(12, Math.min(value, width - cardWidth - 12));
  const clampTop = (value: number) => Math.max(12, Math.min(value, height - cardHeight - 12));
  let left = (width - cardWidth) / 2;
  let top = (height - cardHeight) / 2;
  if (rect && rect.width > 0 && rect.height > 0) {
    if (rect.right + cardWidth + 28 <= width) {
      left = rect.right + 16;
      top = clampTop(rect.top);
    } else if (rect.left - cardWidth - 16 >= 12) {
      left = rect.left - cardWidth - 16;
      top = clampTop(rect.top);
    } else if (rect.bottom + cardHeight + 28 <= height) {
      left = clampLeft(rect.left);
      top = rect.bottom + 16;
    } else if (rect.top - cardHeight - 16 >= 12) {
      left = clampLeft(rect.left);
      top = rect.top - cardHeight - 16;
    } else {
      left = width - cardWidth - 12;
      top = rect.top + rect.height / 2 < height / 2 ? height - cardHeight - 12 : 12;
    }
  }
  const spotlight =
    rect && rect.width > 0 && rect.height > 0
      ? {
          x: Math.max(4, rect.left - 4),
          y: Math.max(4, rect.top - 4),
          width: Math.max(0, Math.min(width - 4, rect.right + 4) - Math.max(4, rect.left - 4)),
          height: Math.max(0, Math.min(height - 4, rect.bottom + 4) - Math.max(4, rect.top - 4)),
        }
      : null;
  return (
    <Dialog.Root
      open={open}
      onOpenChange={(nextOpen) => {
        if (!nextOpen) onDefer();
      }}
    >
      <Dialog.Portal>
        <Dialog.Overlay className="fixed inset-0 z-[70]" data-tour-overlay="">
          <svg width="100%" height="100%" aria-hidden="true" className="absolute inset-0">
            <path
              fill="var(--surface)"
              opacity="0.88"
              fillRule="evenodd"
              d={`M0 0H${width}V${height}H0Z${spotlight ? ` M${spotlight.x} ${spotlight.y}v${spotlight.height}h${spotlight.width}v-${spotlight.height}Z` : ""}`}
            />
            {spotlight && (
              <rect
                x={spotlight.x}
                y={spotlight.y}
                width={spotlight.width}
                height={spotlight.height}
                rx="6"
                fill="none"
                stroke="var(--brand)"
                strokeWidth="2"
              />
            )}
          </svg>
        </Dialog.Overlay>
        <Dialog.Content
          ref={content}
          data-guided-tour=""
          className="card fixed z-[71] flex flex-col gap-5 overflow-y-auto p-5 outline-none shadow-[var(--shadow-lg)]"
          style={{
            left: clampLeft(left),
            top: clampTop(top),
            width: cardWidth,
            maxHeight: height - 24,
          }}
          onPointerDownOutside={(event) => event.preventDefault()}
          onKeyDown={(event) => event.stopPropagation()}
          onInteractOutside={(event) => event.preventDefault()}
          onCloseAutoFocus={(event) => {
            event.preventDefault();
            const previous = returnFocus.current;
            if (previous?.isConnected && previous !== document.body) previous.focus();
            else document.querySelector<HTMLElement>('[data-tour="project-menu"]')?.focus();
          }}
        >
          <div className="flex items-center justify-between gap-3 text-xs text-[var(--text-mut)]">
            <span>{labels.progress}</span>
            <span className="flex gap-1.5" aria-hidden="true">
              {Array.from({ length: totalSteps }, (_, index) => index + 1).map((number) => (
                <span
                  key={number}
                  className={`h-1.5 w-1.5 rounded-full ${number <= step ? "bg-[var(--brand)]" : "bg-[var(--border)]"}`}
                />
              ))}
            </span>
          </div>
          <div className="space-y-2" aria-live="polite" aria-atomic="true">
            <Dialog.Title className="display text-xl font-medium leading-tight text-[var(--text)]">
              {title}
            </Dialog.Title>
            <Dialog.Description className="text-sm leading-relaxed text-[var(--text-mut)]">
              {description}
            </Dialog.Description>
          </div>
          <div className="flex items-center justify-between gap-2">
            <Button variant="ghost" size="sm" onClick={onDefer}>
              {labels.defer}
            </Button>
            <div className="flex gap-1.5">
              {onPrevious && (
                <Button
                  variant="ghost"
                  size="icon"
                  aria-label={labels.previous}
                  disabled={busy}
                  onClick={onPrevious}
                >
                  <ArrowLeft className="size-4" />
                </Button>
              )}
              <Button size="sm" onClick={onNext} disabled={busy}>
                {labels.next}
                <ArrowRight className="size-4" />
              </Button>
            </div>
          </div>
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  );
}
