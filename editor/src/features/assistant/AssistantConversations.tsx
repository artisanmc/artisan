import type { ProjectId } from "@/domain/types";
import { type ConversationSummary, listConversations } from "@/lib/api/assistant";
import { useAuthStore } from "@/state/authStore";
import { Plus } from "lucide-react";
import { useEffect, useState } from "react";
import { useTranslation } from "react-i18next";

/**
 * AssistantConversations — the list view of a workspace's saved AI
 * conversations (newest first). "New conversation" starts a fresh chat;
 * clicking an item resumes it. Scoped per project (the backend filters by
 * `ownerKey` + `projectId`). Rendered by `AssistantBody`.
 */
export function AssistantConversations({
  projectId,
  onOpen,
  onNew,
}: {
  projectId: ProjectId;
  onOpen: (id: string) => void;
  onNew: () => void;
}) {
  const { t } = useTranslation();
  const user = useAuthStore((s) => s.currentUser);
  const [items, setItems] = useState<ConversationSummary[] | null>(null);

  useEffect(() => {
    if (!user) return;
    let cancelled = false;
    listConversations(projectId)
      .then((list) => {
        if (!cancelled) setItems(list);
      })
      .catch(() => {
        if (!cancelled) setItems([]);
      });
    return () => {
      cancelled = true;
    };
  }, [user, projectId]);

  return (
    <div data-testid="assistant-conversations" className="flex min-h-0 flex-1 flex-col">
      <div className="shrink-0 p-3">
        <button type="button" onClick={onNew} className="btn btn-sm btn-primary w-full">
          <Plus className="h-4 w-4" />
          {t("assistant.newConversation")}
        </button>
      </div>

      <div className="min-h-0 flex-1 overflow-y-auto px-2 pb-3">
        {items === null ? (
          <div className="px-2 py-2 text-[12px] text-[var(--text-mut)]">
            {t("assistant.loading")}
          </div>
        ) : items.length === 0 ? (
          <div className="px-2 py-6 text-center text-[12px] text-[var(--text-faint)]">
            {t("assistant.noConversations")}
          </div>
        ) : (
          <ul className="flex flex-col gap-0.5">
            {items.map((conv) => (
              <li key={conv.id}>
                <button
                  type="button"
                  onClick={() => onOpen(conv.id)}
                  className="flex w-full flex-col gap-0.5 rounded-[8px] px-2.5 py-2 text-left transition-colors hover:bg-[var(--surface-hover)]"
                >
                  <span className="truncate text-[13px] text-[var(--text)]">
                    {conv.title || t("assistant.untitled")}
                  </span>
                  <span className="text-[11px] text-[var(--text-faint)]">
                    {new Date(conv.updatedAt).toLocaleString()}
                  </span>
                </button>
              </li>
            ))}
          </ul>
        )}
      </div>
    </div>
  );
}
