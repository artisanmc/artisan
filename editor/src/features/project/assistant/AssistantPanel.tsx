import { Sheet, SheetBody, SheetContent, SheetHeader, SheetTitle } from "@/components/ui/sheet";
import { Spinner } from "@/components/ui/spinner";
import type { AiEvent } from "@/lib/api/ai";
import { cn } from "@/lib/cx";
import {
  AlertTriangle,
  Check,
  FileText,
  RotateCcw,
  SendHorizontal,
  Sparkles,
  X,
} from "lucide-react";
import { type FormEvent, type KeyboardEvent, useEffect, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { useAiStatus, useAssistant } from "./useAssistant";

/** Opens the Drafts list next to Deploy, where the player reviews what the assistant wrote. */
export const OPEN_DRAFTS = "artisan:open-drafts";

/**
 * The editor's assistant (ADR `editor-assistant`): a chat with the admin's model, which reads
 * the Projects and writes drafts. It never deploys: a draft it wrote opens in Drafts.
 */
export function AssistantPanel({
  projectId,
  open,
  onOpenChange,
}: {
  projectId: string;
  open: boolean;
  onOpenChange: (open: boolean) => void;
}) {
  const { t } = useTranslation();
  const status = useAiStatus();
  const { events, running, failure, send, reset } = useAssistant(projectId);
  const [text, setText] = useState("");
  const end = useRef<HTMLDivElement>(null);

  // biome-ignore lint/correctness/useExhaustiveDependencies: scroll on each new line.
  useEffect(() => {
    end.current?.scrollIntoView?.({ block: "end" });
  }, [events.length, running]);

  const submit = (e?: FormEvent) => {
    e?.preventDefault();
    const message = text.trim();
    if (!message || running) return;
    setText("");
    void send(message);
  };
  const onKey = (e: KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === "Enter" && !e.shiftKey) submit(e);
  };

  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent
        side="right"
        className="w-full max-w-md sm:w-[440px]"
        aria-describedby={undefined}
      >
        <SheetHeader>
          <SheetTitle className="flex items-center gap-2">
            <Sparkles className="size-4" />
            {t("ai.title")}
          </SheetTitle>
          {events.length > 0 && (
            <button
              type="button"
              className="btn btn-ghost btn-sm"
              disabled={running}
              onClick={reset}
              title={t("ai.newHint")}
            >
              <RotateCcw className="size-3.5" />
              {t("ai.new")}
            </button>
          )}
        </SheetHeader>
        <SheetBody className="flex flex-col gap-3" data-testid="assistant-log">
          {events.length === 0 && (
            <div className="flex flex-col gap-2 text-[13px] text-[var(--text-mut)]">
              <p>{t("ai.intro")}</p>
              <p className="text-[12px] text-[var(--text-faint)]">
                {t("ai.billing", { model: status?.model ?? "" })}
              </p>
            </div>
          )}
          {events.map((event) => (
            <EventLine key={event.seq} event={event} />
          ))}
          {running && (
            <div className="flex items-center gap-2 text-[13px] text-[var(--text-mut)]">
              <Spinner className="size-3.5" />
              {t("ai.working")}
            </div>
          )}
          {failure && (
            <p role="alert" className="text-[13px] text-[var(--danger)]">
              {t(`ai.errors.${failure}`, { defaultValue: t("ai.errors.unknown") })}
            </p>
          )}
          <div ref={end} />
        </SheetBody>
        <form
          onSubmit={submit}
          className="flex shrink-0 items-end gap-2 border-t border-[var(--border-soft)] p-3"
        >
          <textarea
            className="textarea max-h-40 min-h-[44px] flex-1"
            rows={2}
            value={text}
            onChange={(e) => setText(e.target.value)}
            onKeyDown={onKey}
            placeholder={t("ai.placeholder")}
            aria-label={t("ai.placeholder")}
            maxLength={8000}
          />
          <button
            type="submit"
            className="btn btn-primary btn-icon size-10 shrink-0"
            disabled={running || !text.trim()}
            aria-label={t("ai.send")}
          >
            <SendHorizontal className="size-4" />
          </button>
        </form>
      </SheetContent>
    </Sheet>
  );
}

function EventLine({ event }: { event: AiEvent }) {
  const { t } = useTranslation();
  switch (event.type) {
    case "user":
      return (
        <div className="ml-8 self-end whitespace-pre-wrap rounded-[var(--r-lg)] bg-[var(--brand-soft)] px-3 py-2 text-[13.5px] text-[var(--text)]">
          {event.text}
        </div>
      );
    case "text":
      return (
        <div className="mr-4 whitespace-pre-wrap text-[13.5px] leading-relaxed text-[var(--text)]">
          {event.text}
        </div>
      );
    case "tool":
      return <ToolLine event={event} />;
    case "notice":
      return (
        <p className="flex items-center gap-1.5 text-[12.5px] text-[var(--warning)]">
          <AlertTriangle className="size-3.5 shrink-0" />
          {t(`ai.notices.${event.code}`, { steps: event.steps, defaultValue: event.code })}
        </p>
      );
    case "error":
      return (
        <p role="alert" className="flex items-center gap-1.5 text-[12.5px] text-[var(--danger)]">
          <AlertTriangle className="size-3.5 shrink-0" />
          {t(`ai.errors.${event.code}`, { defaultValue: t("ai.errors.unknown") })}
        </p>
      );
    case "done":
      return null;
  }
}

function ToolLine({ event }: { event: Extract<AiEvent, { type: "tool" }> }) {
  const { t } = useTranslation();
  const label = t(`ai.tools.${event.name}`, { path: event.path ?? "", defaultValue: event.name });
  return (
    <div className="flex flex-col gap-1.5">
      <div
        className={cn(
          "flex items-center gap-1.5 font-mono text-[12px]",
          event.ok ? "text-[var(--text-faint)]" : "text-[var(--warning)]",
        )}
      >
        {event.ok ? <Check className="size-3 shrink-0" /> : <X className="size-3 shrink-0" />}
        <span className="truncate">{label}</span>
        {!event.ok && event.problems ? (
          <span className="shrink-0">· {t("ai.problems", { count: event.problems })}</span>
        ) : null}
      </div>
      {event.name === "start_draft" && event.draft && (
        <button
          type="button"
          className="btn btn-outline btn-sm self-start"
          onClick={() =>
            window.dispatchEvent(new CustomEvent(OPEN_DRAFTS, { detail: event.draft }))
          }
        >
          <FileText className="size-3.5" />
          {t("ai.openDrafts", { name: event.draft.name ?? "" })}
        </button>
      )}
    </div>
  );
}
