import type { ProjectId } from "@/domain/types";
import { AssistantChat } from "@/features/assistant/AssistantChat";
import { AssistantConversations } from "@/features/assistant/AssistantConversations";
import { useState } from "react";

/**
 * AssistantBody — switches between the conversation LIST and a single CHAT.
 * Hosted by the shared WorkspaceOverlay (`?tab=assistant`). Opens on the
 * list so the user can resume a past
 * conversation or start a new one.
 *
 * The chat is keyed per conversation (`<id>-<nonce>`) so switching — including
 * "new" → "new" — remounts `AssistantChat` with fresh state, and a resumed
 * conversation loads its transcript on mount.
 */
export function AssistantBody({ projectId }: { projectId: ProjectId }) {
  const [view, setView] = useState<"list" | "chat">("list");
  const [activeConvId, setActiveConvId] = useState<string | null>(null);
  const [nonce, setNonce] = useState(0);

  const openChat = (id: string | null) => {
    setActiveConvId(id);
    setNonce((n) => n + 1);
    setView("chat");
  };

  if (view === "chat") {
    return (
      <AssistantChat
        key={`${activeConvId ?? "new"}-${nonce}`}
        projectId={projectId}
        conversationId={activeConvId}
        onBack={() => setView("list")}
      />
    );
  }
  return (
    <AssistantConversations
      projectId={projectId}
      onOpen={(id) => openChat(id)}
      onNew={() => openChat(null)}
    />
  );
}
