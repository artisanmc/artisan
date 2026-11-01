import { Spinner } from "@/components/ui/spinner";
import { DeployReviewDialog } from "@/features/project/DeployReviewDialog";
import { Composer, EventLine } from "@/features/project/assistant/AssistantPanel";
import {
  setCurrentConversation,
  useAiStatus,
  useAssistant,
} from "@/features/project/assistant/useAssistant";
import { deployDraftsAndReport } from "@/features/project/publish/deployDrafts";
import { selectedDrafts, useOtherDrafts } from "@/features/project/publish/useOtherDrafts";
import { useServerProjects } from "@/features/project/useServerProjects";
import { type AiConversationSummary, listAiConversations } from "@/lib/api/ai";
import { cn } from "@/lib/cx";
import { useParams } from "@tanstack/react-router";
import { MessageSquarePlus, Play, Sparkles } from "lucide-react";
import { useEffect, useMemo, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { ArtifactCard } from "./ArtifactCard";
import { artifactsOf, conversationDrafts, draftVersions } from "./artifacts";

const ROUTE = "/servers/$serverId/assistant" as const;

/**
 * The server's Assistant tab (ADR `editor-assistant`): the conversations on the left, the current
 * one in the middle, and each file it wrote on the right, in its Project, shown as the game would
 * or as YAML against what the server runs. The assistant works across the server's Projects, one
 * draft per Project; "Review and deploy" opens Deploy's review with all of them picked.
 * The docked panel shows the same conversation ("Expand").
 */
export function AssistantPage() {
  const { t } = useTranslation();
  const { serverId } = useParams({ from: ROUTE });
  const status = useAiStatus();
  const { id, events, running, failure, send, reset } = useAssistant({ server: serverId });
  // A module the assistant created joins the listing: its cards name it and show its menus.
  const created = events.filter(
    (e) => e.type === "tool" && e.name === "create_module" && e.ok,
  ).length;
  const { projects, probes } = useServerProjects(serverId, created);
  const others = useOtherDrafts();
  const list = useConversationList(serverId, id, running);

  const end = useRef<HTMLDivElement>(null);
  // biome-ignore lint/correctness/useExhaustiveDependencies: scroll on each new line.
  useEffect(() => {
    end.current?.scrollIntoView?.({ block: "end" });
  }, [events.length, running]);

  const artifacts = useMemo(() => artifactsOf(events), [events]);
  const versions = useMemo(() => draftVersions(events), [events]);
  const drafts = useMemo(() => conversationDrafts(events), [events]);

  if (status && (!status.enabled || !status.canUse))
    return (
      <div className="flex h-full items-center justify-center p-6 text-[13px] text-[var(--text-mut)]">
        {t(status.enabled ? "ai.page.forbidden" : "ai.page.off")}
      </div>
    );

  const confirm = async () => {
    const queue = selectedDrafts(others.state);
    others.close();
    if (queue.length > 0) await deployDraftsAndReport(t, queue);
  };

  return (
    <div
      className="flex h-full min-h-0 bg-[var(--bg)] max-lg:flex-col max-lg:overflow-y-auto"
      data-testid="assistant-page"
    >
      {probes}
      <nav
        aria-label={t("ai.page.conversations")}
        className="flex w-60 shrink-0 flex-col gap-2 border-r border-[var(--border-soft)] p-3 max-lg:w-full max-lg:border-r-0 max-lg:border-b"
      >
        <button
          type="button"
          className="btn btn-outline btn-sm justify-start"
          disabled={running}
          onClick={reset}
        >
          <MessageSquarePlus className="size-3.5" />
          {t("ai.page.newConversation")}
        </button>
        <h2 className="eyebrow mt-2 text-[var(--text-mut)]">{t("ai.page.conversations")}</h2>
        <ul className="flex min-h-0 flex-1 flex-col gap-0.5 overflow-y-auto">
          {list.status === "failed" ? (
            <li className="text-[12.5px] text-[var(--danger)]">{t("ai.page.loadFailed")}</li>
          ) : list.items.length === 0 ? (
            <li className="text-[12.5px] text-[var(--text-faint)]">{t("ai.page.none")}</li>
          ) : (
            list.items.map((c) => (
              <li key={c.id}>
                <button
                  type="button"
                  aria-current={c.id === id ? "true" : undefined}
                  onClick={() => setCurrentConversation(c.id)}
                  className={cn(
                    "flex w-full flex-col items-start gap-0.5 rounded-[var(--r-sm)] px-2 py-1.5 text-left text-[13px]",
                    c.id === id
                      ? "bg-[var(--brand-soft)] text-[var(--text)]"
                      : "text-[var(--text-mut)] hover:bg-[var(--surface-hover)] hover:text-[var(--text)]",
                  )}
                >
                  <span className="w-full truncate">{c.title ?? t("ai.page.untitled")}</span>
                  {c.running && (
                    <span className="text-[11.5px] text-[var(--brand)]">
                      {t("ai.page.answering")}
                    </span>
                  )}
                </button>
              </li>
            ))
          )}
        </ul>
        <p className="text-[11.5px] text-[var(--text-faint)]">{t("ai.page.keptNote")}</p>
      </nav>

      <section
        aria-label={t("ai.title")}
        className="flex min-h-0 min-w-0 flex-1 flex-col max-lg:min-h-[60dvh]"
      >
        <div
          className="mx-auto flex min-h-0 w-full max-w-3xl flex-1 flex-col gap-3 overflow-y-auto p-4"
          data-testid="assistant-log"
        >
          {events.length === 0 && (
            <div className="flex flex-col gap-2 text-[13px] text-[var(--text-mut)]">
              <p className="flex items-center gap-2 font-medium text-[var(--text)]">
                <Sparkles className="size-4" />
                {t("ai.title")}
              </p>
              <p>{t("ai.page.intro")}</p>
              {status && (
                <p className="text-[12px] text-[var(--text-faint)]">
                  {t("ai.billing", { model: status.model ?? "" })}
                </p>
              )}
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
          {drafts.length > 0 && !running && (
            <button
              type="button"
              className="btn btn-primary btn-sm self-start"
              onClick={() => others.load(undefined, drafts)}
            >
              <Play className="size-3.5" fill="currentColor" aria-hidden />
              {t("ai.reviewDeploy", { count: drafts.length })}
            </button>
          )}
          {failure && (
            <p role="alert" className="text-[13px] text-[var(--danger)]">
              {t(`ai.errors.${failure}`, { defaultValue: t("ai.errors.unknown") })}
            </p>
          )}
          <div ref={end} />
        </div>
        <div className="mx-auto w-full max-w-3xl">
          <Composer running={running} onSend={send} serverId={serverId} />
        </div>
      </section>

      <aside
        aria-label={t("ai.page.files")}
        className="flex min-h-0 w-[min(46%,720px)] shrink-0 flex-col gap-3 overflow-y-auto border-l border-[var(--border-soft)] p-3 max-lg:w-full max-lg:border-l-0 max-lg:border-t"
      >
        <h2 className="eyebrow text-[var(--text-mut)]">{t("ai.page.files")}</h2>
        {artifacts.length === 0 ? (
          <p className="text-[12.5px] text-[var(--text-faint)]">{t("ai.page.noFiles")}</p>
        ) : (
          artifacts.map((artifact) => (
            <ArtifactCard
              key={artifact.key}
              artifact={artifact}
              version={versions.get(artifact.draftId) ?? artifact.seq}
              serverId={serverId}
              projects={projects}
            />
          ))
        )}
      </aside>

      <DeployReviewDialog
        changes={null}
        othersOnly
        others={others.state}
        onToggleOther={others.toggle}
        onCancel={others.close}
        onConfirm={() => void confirm()}
      />
    </div>
  );
}

type ConversationList =
  | { status: "loading" | "ready"; items: AiConversationSummary[] }
  | { status: "failed"; items: AiConversationSummary[] };

/**
 * The player's conversations on this server (and those started outside any server), read again
 * when the current one changes or ends a turn: its title is its first message.
 */
function useConversationList(
  serverId: string,
  current: string | null,
  running: boolean,
): ConversationList {
  const [list, setList] = useState<ConversationList>({ status: "loading", items: [] });
  // biome-ignore lint/correctness/useExhaustiveDependencies: read again on each of these.
  useEffect(() => {
    let cancelled = false;
    listAiConversations().then(
      (all) =>
        !cancelled &&
        setList({
          status: "ready",
          items: all.filter((c) => !c.server || c.server === serverId),
        }),
      () => !cancelled && setList((l) => ({ status: "failed", items: l.items })),
    );
    return () => {
      cancelled = true;
    };
  }, [serverId, current, running]);
  return list;
}
