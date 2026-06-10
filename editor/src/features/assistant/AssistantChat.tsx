import type { PackId } from "@/domain/types";
import { packToMenuV1 } from "@/features/export/transform";
import { openConversation, streamAssistant } from "@/lib/api/assistant";
import { useAccountStore } from "@/state/accountStore";
import { useAuthStore } from "@/state/authStore";
import { useSessionStore } from "@/state/sessionStore";
import { useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { toast } from "sonner";

type Entry =
  | { role: "user" | "assistant"; text: string }
  | { role: "card"; kind: "written" | "deleted"; id: string };

/**
 * AssistantChat — the AI chat body (transcript + composer + file drag-drop +
 * the streaming send loop). Presentation-agnostic: rendered inside the desktop
 * resizable pane (`AssistantPane`) and the mobile drawer (`AssistantPanel`), so
 * the chat behaviour lives in exactly one place.
 *
 * The SSE loop (`streamAssistant`) renders streamed text incrementally and
 * applies engine events live to the canvas:
 *   - `menu_written` → `accountStore.applyAssistantMenu` (upsert)
 *   - `menu_deleted` → `accountStore.deleteFromPack`
 * Each message re-seeds the working copy with `packToMenuV1(pack)` +
 * `attachments` (last-writer-wins) so the assistant stays in sync with whatever
 * the user has edited by hand. Auth: a session token (plugin trust-dance) OR a
 * logged-in web user — the request rides the `artisan_user_session` cookie when
 * there is no token (see `lib/api/assistant.ts`).
 */
export function AssistantChat({ packId }: { packId: PackId }) {
  const { t } = useTranslation();
  const token = useSessionStore((s) => s.accessToken);
  const user = useAuthStore((s) => s.currentUser);

  const [entries, setEntries] = useState<Entry[]>([]);
  const [input, setInput] = useState("");
  const [busy, setBusy] = useState(false);
  const [attachments, setAttachments] = useState<Record<string, string>>({});
  const convId = useRef<string | null>(null);

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
        convId.current = await openConversation(token, { menus, attachments });
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

      <div className="flex shrink-0 items-end gap-2 border-t border-[var(--border-soft)] p-3">
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
