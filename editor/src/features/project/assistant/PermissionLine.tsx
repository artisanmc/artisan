import {
  type AiEvent,
  type AiPermissionAnswer,
  answerAiPermission,
  generatedImagePath,
} from "@/lib/api/ai";
import { apiUrl } from "@/lib/api/client";
import { Ban, Check, Coins } from "lucide-react";
import { useState } from "react";
import { useTranslation } from "react-i18next";
import { followConversation, useConversationsStore } from "./useAssistant";

type Permission = Extract<AiEvent, { type: "permission" }>;

/**
 * The assistant asking before a tool the server's owner pays for (`generate_image`), as in a
 * coding agent: what it is about to do, then "once", "always" or "deny". The turn waits on the
 * hub for the answer. Answered, the question leaves and its answer stays as one line.
 */
export function PermissionLine({ event }: { event: Permission }) {
  const { t } = useTranslation();
  const id = useConversationsStore((s) => s.currentId);
  const view = useConversationsStore((s) => (id ? s.byId[id] : undefined));
  const [busy, setBusy] = useState(false);
  const [failed, setFailed] = useState(false);
  const tool = t(`ai.permission.tools.${event.tool}`, { defaultValue: event.tool });

  if (event.state !== "asked")
    return (
      <p className="flex items-center gap-1.5 font-mono text-[12px] text-[var(--text-faint)]">
        {event.state === "once" || event.state === "always" ? (
          <Check className="size-3 shrink-0" />
        ) : (
          <Ban className="size-3 shrink-0" />
        )}
        {t(`ai.permission.states.${event.state}`, { tool })}
      </p>
    );

  // Answered (its answer is a later event), or the turn ended without one (a restart): nothing to ask.
  const answered = view?.events.some(
    (e) => e.type === "permission" && e.request === event.request && e.state !== "asked",
  );
  if (!id || !view?.running || answered) return null;

  const answer = async (choice: AiPermissionAnswer) => {
    setBusy(true);
    setFailed(false);
    try {
      await answerAiPermission(id, event.request, choice);
    } catch {
      // Closed meanwhile (answered in another tab, or the wait ran out): the events say which.
      setFailed(true);
    } finally {
      setBusy(false);
      void followConversation(id);
    }
  };

  return (
    <fieldset
      aria-label={t("ai.permission.title", { tool })}
      data-testid="assistant-permission"
      className="card flex min-w-0 flex-col gap-3 border-[var(--brand)] p-3"
    >
      <p className="flex items-center gap-2 text-[13px] font-semibold text-[var(--text)]">
        <Coins className="size-4 shrink-0 text-[var(--brand)]" />
        {t("ai.permission.title", { tool })}
      </p>
      <p className="text-[12.5px] text-[var(--text-mut)]">
        {t(`ai.permission.why.${event.tool}`, { defaultValue: t("ai.permission.whyDefault") })}
      </p>
      {event.detail?.prompt && (
        <blockquote className="max-h-32 overflow-y-auto whitespace-pre-wrap rounded-[var(--r-md)] bg-[var(--surface-inset)] px-2.5 py-2 font-mono text-[12px] text-[var(--text)]">
          {event.detail.prompt}
        </blockquote>
      )}
      <div className="flex flex-wrap justify-end gap-2">
        <button
          type="button"
          className="btn btn-ghost btn-sm"
          disabled={busy}
          onClick={() => void answer("denied")}
        >
          {t("ai.permission.deny")}
        </button>
        <button
          type="button"
          className="btn btn-outline btn-sm"
          disabled={busy}
          title={t("ai.permission.alwaysHint")}
          onClick={() => void answer("always")}
        >
          {t("ai.permission.always")}
        </button>
        <button
          type="button"
          className="btn btn-primary btn-sm"
          disabled={busy}
          onClick={() => void answer("once")}
        >
          {t("ai.permission.once")}
        </button>
      </div>
      {failed && (
        <p role="alert" className="text-[12px] text-[var(--danger)]">
          {t("ai.permission.closed")}
        </p>
      )}
    </fieldset>
  );
}

/**
 * A picture the server's image model made, by the name the hub keeps it under. The hub holds a
 * player's last pictures in memory: once it is gone (a restart, newer pictures), a line says so.
 */
export function GeneratedPicture({ name }: { name: string }) {
  const { t } = useTranslation();
  const [gone, setGone] = useState(false);
  if (gone) return <p className="text-[12px] text-[var(--text-faint)]">{t("ai.generatedGone")}</p>;
  return (
    <a
      href={apiUrl(generatedImagePath(name))}
      target="_blank"
      rel="noreferrer"
      className="self-start"
    >
      <img
        src={apiUrl(generatedImagePath(name))}
        alt={t("ai.generatedAlt", { name })}
        className="max-h-56 max-w-full rounded-[var(--r-md)] border border-[var(--border-soft)]"
        onError={() => setGone(true)}
      />
    </a>
  );
}
