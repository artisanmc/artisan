import type { PackId } from "@/domain/types";
import { packToMenuV1 } from "@/features/export/transform";
import {
  type ConversationMessage,
  getConversation,
  openConversation,
  streamAssistant,
} from "@/lib/api/assistant";
import { useAccountStore } from "@/state/accountStore";
import { useAuthStore } from "@/state/authStore";
import { useSessionStore } from "@/state/sessionStore";
import { ChevronLeft } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { toast } from "sonner";

type Entry =
  | { role: "user" | "assistant"; text: string }
  | { role: "card"; kind: "written" | "deleted"; id: string };

/** Rebuild display bubbles from a persisted transcript (skip system/tool/empty). */
function messagesToEntries(messages: ConversationMessage[]): Entry[] {
  const out: Entry[] = [];
  for (const m of messages) {
    if (
      (m.role === "user" || m.role === "assistant") &&
      typeof m.content === "string" &&
      m.content
    ) {
      out.push({ role: m.role, text: m.content });
    }
  }
  return out;
}

/**
 * AssistantChat — the AI chat body (transcript + composer + file drag-drop +
 * the streaming send loop). Presentation-agnostic: rendered inside the desktop
 * resizable pane and the mobile drawer, both via `AssistantBody`.
 *
 * When `conversationId` is set, the persisted transcript is loaded on mount
 * (resume); when null it's a fresh conversation, created lazily on first send.
 * The parent keys this component per conversation, so its state is fresh on
 * every switch. `onBack` returns to the conversation list.
 *
 * The SSE loop (`streamAssistant`) renders streamed text incrementally and
 * applies engine events live to the canvas: `menu_written` → `applyAssistantMenu`,
 * `menu_deleted` → `deleteFromPack`. Each message re-seeds the backend working
 * copy with `packToMenuV1(pack)` + `attachments`. Auth: a session token OR a
 * logged-in user (cookie); see `lib/api/assistant.ts`.
 */
export function AssistantChat({
  packId,
  conversationId = null,
  onBack,
}: {
  packId: PackId;
  conversationId?: string | null;
  onBack?: () => void;
}) {
  const { t } = useTranslation();
  const token = useSessionStore((s) => s.accessToken);
  const user = useAuthStore((s) => s.currentUser);

  const [entries, setEntries] = useState<Entry[]>([]);
  const [input, setInput] = useState("");
  const [busy, setBusy] = useState(false);
  const [attachments, setAttachments] = useState<Record<string, string>>({});
  const convId = useRef<string | null>(conversationId);

  // Resume: load the persisted transcript (parent keys us per conversation).
  useEffect(() => {
    if (!conversationId) return;
    let cancelled = false;
    getConversation(token, conversationId)
      .then((c) => {
        if (!cancelled) setEntries(messagesToEntries(c.messages));
      })
      .catch(() => {});
    return () => {
      cancelled = true;
    };
  }, [conversationId, token]);

  /** Append `chunk` to the trailing assistant entry, or start a new one. */
  function appendAssistant(chunk: string) {
    setEntries((e) => {
      const copy = [...e];
      const last = copy[copy.length - 1];
      // Coalesce consecutive assistant chunks into one entry; anything else
      // (user message, card) means we start a fresh assistant bubble.
      if (last && last.role === "assistant") {
        copy[copy.length - 1] = { role: "assistant", text: last.text + chunk };
        return copy;
      }
      return [...copy, { role: "assistant", text: chunk }];
    });
  }

  async function send() {
    const text = input.trim();
    if ((!token && !user) || !text || busy) return;
    setInput("");
    setEntries((e) => [...e, { role: "user", text }]);
    setBusy(true);
    try {
      const pack = useAccountStore.getState().account.packs.find((p) => p.id === packId);
      const lang = pack?.defaultLang ?? "en";
      const menus = pack ? packToMenuV1(pack) : [];
      if (!convId.current) {
        convId.current = await openConversation(token, { packId });
      }
      for await (const ev of streamAssistant(token, convId.current, { text, menus, attachments })) {
        if (ev.type === "text") {
          appendAssistant(String(ev.text ?? ""));
        } else if (ev.type === "menu_written") {
          const menu = ev.menu as Record<string, unknown>;
          useAccountStore.getState().applyAssistantMenu({ packId, menuV1: menu, lang });
          setEntries((e) => [...e, { role: "card", kind: "written", id: String(menu.id) }]);
        } else if (ev.type === "menu_deleted") {
          useAccountStore.getState().deleteFromPack({ packId, nodeIds: [String(ev.id)] });
          setEntries((e) => [...e, { role: "card", kind: "deleted", id: String(ev.id) }]);
        } else if (ev.type === "error") {
          toast.error(String(ev.message ?? t("assistant.errorGeneric")));
        }
      }
    } catch {
      toast.error(t("assistant.errorGeneric"));
    } finally {
      setBusy(false);
    }
  }

  async function onDrop(e: React.DragEvent) {
    e.preventDefault();
    const files = Array.from(e.dataTransfer?.files ?? []);
    if (files.length === 0) return;
    const next: Record<string, string> = { ...attachments };
    for (const file of files) next[file.name] = await file.text();
    setAttachments(next);
  }

  const attachmentCount = Object.keys(attachments).length;

  return (
    <div
      data-testid="assistant-panel"
      className="flex min-h-0 flex-1 flex-col"
      onDragOver={(e) => e.preventDefault()}
      onDrop={onDrop}
    >
      {onBack && (
        <div className="flex shrink-0 items-center border-[var(--border-soft)] border-b px-2 py-1.5">
          <button
            type="button"
            onClick={onBack}
            className="flex items-center gap-1 rounded-[8px] px-2 py-1 text-[12px] text-[var(--text-mut)] transition-colors hover:bg-[var(--surface-hover)] hover:text-[var(--text)]"
          >
            <ChevronLeft className="h-3.5 w-3.5" />
            {t("assistant.backToList")}
          </button>
        </div>
      )}

      <div className="min-h-0 flex-1 overflow-y-auto px-4 py-3">
        <div
          data-testid="assistant-transcript"
          className="flex flex-col gap-2 text-[13px] text-[var(--text)]"
        >
          {entries.map((en, i) =>
            en.role === "card" ? (
              <div
                // biome-ignore lint/suspicious/noArrayIndexKey: transcript entries are append-only and stable within a render
                key={i}
                className="text-[12px] text-[var(--text-faint)]"
              >
                {t(en.kind === "written" ? "assistant.menuCreated" : "assistant.menuDeleted", {
                  id: en.id,
                })}
              </div>
            ) : (
              <div
                // biome-ignore lint/suspicious/noArrayIndexKey: transcript entries are append-only and stable within a render
                key={i}
                data-role={en.role}
                className={
                  en.role === "user"
                    ? "self-end rounded-[10px] bg-[var(--surface-hover)] px-3 py-1.5"
                    : "whitespace-pre-wrap"
                }
              >
                {en.text}
              </div>
            ),
          )}
          {busy && (
            <div data-testid="assistant-thinking" className="text-[12px] text-[var(--text-mut)]">
              {t("assistant.thinking")}
            </div>
          )}
        </div>
      </div>

      {attachmentCount > 0 && (
        <div className="shrink-0 px-4 text-[12px] text-[var(--text-mut)]">
          {t("assistant.attach", { count: attachmentCount })}
        </div>
      )}

      <div className="flex shrink-0 items-end gap-2 border-[var(--border-soft)] border-t p-3">
        <textarea
          value={input}
          onChange={(e) => setInput(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter" && !e.shiftKey) {
              e.preventDefault();
              void send();
            }
          }}
          placeholder={t("assistant.placeholder")}
          aria-label={t("assistant.title")}
          rows={2}
          className="min-h-[44px] flex-1 resize-none rounded-[10px] border border-[var(--border)] bg-[var(--surface-raised)] px-3 py-2 text-[13px] text-[var(--text)] outline-none focus:border-[var(--border-strong)]"
        />
        <button
          type="button"
          disabled={busy || input.trim().length === 0}
          onClick={() => void send()}
          className="btn btn-sm btn-deploy shrink-0"
        >
          {t("assistant.send")}
        </button>
      </div>
    </div>
  );
}
