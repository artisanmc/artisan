import { Markdown } from "@/components/ui/markdown";
import { ResizeHandle } from "@/components/ui/resize-handle";
import { Spinner } from "@/components/ui/spinner";
import type { AiEvent } from "@/lib/api/ai";
import { cn } from "@/lib/cx";
import { ASSISTANT_WIDTH, useAssistantPanelStore } from "@/state/assistantPanelStore";
import {
  AlertTriangle,
  Check,
  FileText,
  RotateCcw,
  SendHorizontal,
  Sparkles,
  X,
} from "lucide-react";
import {
  type CSSProperties,
  type FormEvent,
  type KeyboardEvent,
  useEffect,
  useRef,
  useState,
} from "react";
import { useTranslation } from "react-i18next";
import { useAiStatus, useAssistant } from "./useAssistant";

/** Opens the Drafts list next to Deploy, where the player reviews what the assistant wrote. */
export const OPEN_DRAFTS = "artisan:open-drafts";

/**
 * The editor's assistant (ADR `editor-assistant`): a chat with the admin's model, which reads
 * the Projects and writes drafts. It never deploys: a draft it wrote opens in Drafts.
 *
 * Docked on the right of the app, beside the page: the canvas and the chat stay usable together,
 * and the conversation survives moving between Projects. Closed, it stays mounted (hidden) so the
 * conversation is still there when it opens again. On a narrow screen it covers the page.
 */
export function AssistantDock({ projectId }: { projectId: string | null }) {
  const { t } = useTranslation();
  const status = useAiStatus();
  const { open, setOpen, width, setWidth } = useAssistantPanelStore();
  const { events, running, failure, send, reset } = useAssistant(projectId);
  const [text, setText] = useState("");
  const end = useRef<HTMLDivElement>(null);

  // biome-ignore lint/correctness/useExhaustiveDependencies: scroll on each new line.
  useEffect(() => {
    end.current?.scrollIntoView?.({ block: "end" });
  }, [events.length, running, open]);

  if (!status?.enabled || !status.canUse) return null;

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
    <aside
      aria-label={t("ai.title")}
      data-testid="assistant-dock"
      hidden={!open}
      style={{ "--assistant-width": `${width}px` } as CSSProperties}
      className={cn(
        "fixed inset-0 z-50 w-full flex-col bg-[var(--surface-raised)] lg:relative lg:inset-auto lg:z-auto lg:w-[var(--assistant-width)] lg:max-w-[60vw] lg:shrink-0 lg:border-l lg:border-[var(--border-soft)]",
        open ? "flex" : "hidden",
      )}
    >
      <ResizeHandle
        edge="left"
        value={width}
        min={ASSISTANT_WIDTH.min}
        max={ASSISTANT_WIDTH.max}
        onResize={setWidth}
        onReset={() => setWidth(ASSISTANT_WIDTH.default)}
        label={t("ai.resize")}
        className="hidden lg:block"
      />
      <div className="flex shrink-0 items-center justify-between gap-2 border-b border-[var(--border-soft)] px-4 py-3">
        <h2 className="eyebrow flex items-center gap-2 text-[var(--text-mut)]">
          <Sparkles className="size-4" />
          {t("ai.title")}
        </h2>
        <div className="flex items-center gap-1">
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
          <button
            type="button"
            className="btn btn-ghost btn-icon size-8"
            onClick={() => setOpen(false)}
            aria-label={t("ai.close")}
            title={t("ai.close")}
          >
            <X className="size-4" />
          </button>
        </div>
      </div>
      <div
        className="flex min-h-0 flex-1 flex-col gap-3 overflow-y-auto p-4"
        data-testid="assistant-log"
      >
        {events.length === 0 && (
          <div className="flex flex-col gap-2 text-[13px] text-[var(--text-mut)]">
            <p>{t("ai.intro")}</p>
            <p className="text-[12px] text-[var(--text-faint)]">
              {t("ai.billing", { model: status.model ?? "" })}
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
      </div>
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
    </aside>
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
      return <Markdown className="mr-4">{event.text}</Markdown>;
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
