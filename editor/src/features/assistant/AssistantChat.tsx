import type { ProjectId } from "@/domain/types";
import { ModelSelector } from "@/features/assistant/ModelSelector";
import { OutOfCreditsNotice } from "@/features/assistant/OutOfCreditsNotice";
import { CreditIndicator } from "@/features/billing/CreditIndicator";
import { packToCommandV1, packToDialogV1, packToMenuV1 } from "@/features/export/transform";
import { persistProject } from "@/features/project/persistProject";
import { getBalance } from "@/lib/api/aiUser";
import type { BalanceBreakdown } from "@/lib/api/billing";
import {
  type ConversationMessage,
  getConversation,
  openConversation,
  streamAssistant,
} from "@/lib/api/assistant";
import { useAccountStore } from "@/state/accountStore";
import { useAuthStore } from "@/state/authStore";
import { useNavigate } from "@tanstack/react-router";
import { ChevronLeft, FileText, Paperclip, X } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { toast } from "sonner";

type Entry =
  | { role: "user" | "assistant"; text: string }
  | { role: "card"; kind: "written" | "deleted"; id: string };

/**
 * Map a backend tool name to the i18n key of its friendly activity label.
 * Unknown / not-yet-running tools fall back to the generic "thinking" line.
 */
const ACTIVITY_KEYS: Record<string, string> = {
  read_attachment: "assistant.activity.reading",
  list_menus: "assistant.activity.menus",
  get_menu: "assistant.activity.menus",
  upsert_menu: "assistant.activity.writeMenu",
  delete_menu: "assistant.activity.deleteMenu",
  list_commands: "assistant.activity.commands",
  get_command: "assistant.activity.commands",
  upsert_command: "assistant.activity.writeCommand",
  delete_command: "assistant.activity.deleteCommand",
  list_dialogs: "assistant.activity.dialogs",
  get_dialog: "assistant.activity.dialogs",
  upsert_dialog: "assistant.activity.writeDialog",
  delete_dialog: "assistant.activity.deleteDialog",
};

function labelKeyFor(name: string): string {
  return ACTIVITY_KEYS[name] ?? "assistant.thinking";
}

/** Human-readable byte size of an attachment's text content (UTF-8). */
function formatBytes(text: string): string {
  const n = new TextEncoder().encode(text).length;
  if (n < 1024) return `${n} B`;
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(1)} KB`;
  return `${(n / (1024 * 1024)).toFixed(1)} MB`;
}

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
 * `menu_deleted` → `deleteFromProject`. Each message re-seeds the backend working
 * copy with `packToMenuV1(pack)` + `attachments`. Auth: a logged-in user
 * (cookie); see `lib/api/assistant.ts`.
 */
export function AssistantChat({
  projectId,
  conversationId = null,
  onBack,
}: {
  projectId: ProjectId;
  conversationId?: string | null;
  onBack?: () => void;
}) {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const user = useAuthStore((s) => s.currentUser);

  const [entries, setEntries] = useState<Entry[]>([]);
  const [input, setInput] = useState("");
  const [busy, setBusy] = useState(false);
  const [activity, setActivity] = useState<string | null>(null);
  const [turnError, setTurnError] = useState<string | null>(null);
  const [attachments, setAttachments] = useState<Record<string, string>>({});
  const [modelId, setModelId] = useState<string | null>(null);
  const [balance, setBalance] = useState<BalanceBreakdown | null>(null);
  const [outOfCredits, setOutOfCredits] = useState(false);
  const convId = useRef<string | null>(conversationId);

  // Resume: load the persisted transcript (parent keys us per conversation).
  useEffect(() => {
    if (!conversationId) return;
    let cancelled = false;
    getConversation(conversationId)
      .then((c) => {
        if (!cancelled) setEntries(messagesToEntries(c.messages));
      })
      .catch(() => {});
    return () => {
      cancelled = true;
    };
  }, [conversationId]);

  // Credit balance for this project — shown next to the model picker.
  useEffect(() => {
    let cancelled = false;
    getBalance(projectId)
      .then((b) => {
        if (!cancelled) setBalance(b);
      })
      .catch(() => {});
    return () => {
      cancelled = true;
    };
  }, [projectId]);

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
    const attachedNames = Object.keys(attachments);
    if (!user || (!text && attachedNames.length === 0) || busy) return;
    setInput("");
    const shown = text || t("assistant.sentFiles", { names: attachedNames.join(", ") });
    setEntries((e) => [...e, { role: "user", text: shown }]);
    setBusy(true);
    setActivity(null);
    setTurnError(null);
    try {
      const pack = useAccountStore.getState().account.projects.find((p) => p.id === projectId);
      const lang = pack?.defaultLang ?? "en";
      const menus = pack ? packToMenuV1(pack) : [];
      const commands = pack ? packToCommandV1(pack) : [];
      const dialogs = pack ? packToDialogV1(pack) : [];
      // Translation values behind the {i18n:<key>} refs — without them the
      // model can see the refs but never the actual text.
      const translations = pack ? pack.i18nKeys : {};
      if (!convId.current) {
        convId.current = await openConversation({ projectId });
      }
      let dirty = false;
      for await (const ev of streamAssistant(convId.current, {
        text,
        menus,
        attachments,
        commands,
        dialogs,
        translations,
        modelId: modelId ?? undefined,
      })) {
        if (ev.type === "text") {
          // Once the model starts writing its answer, the streamed text is the
          // live feedback — fall back to the generic thinking label.
          setActivity(null);
          appendAssistant(String(ev.text ?? ""));
        } else if (ev.type === "tool") {
          setActivity(labelKeyFor(String(ev.name)));
        } else if (ev.type === "menu_written") {
          const menu = ev.menu as Record<string, unknown>;
          const unsupported = useAccountStore
            .getState()
            .applyAssistantMenu({ projectId, menuV1: menu, lang });
          if (unsupported.length > 0) {
            toast.warning(
              t("assistant.unsupportedDropped", {
                id: String(menu.id),
                list: [...new Set(unsupported)].join(", "),
              }),
            );
          }
          setEntries((e) => [...e, { role: "card", kind: "written", id: String(menu.id) }]);
          dirty = true;
        } else if (ev.type === "menu_deleted") {
          useAccountStore.getState().deleteFromProject({ projectId, nodeIds: [String(ev.id)] });
          setEntries((e) => [...e, { role: "card", kind: "deleted", id: String(ev.id) }]);
          dirty = true;
        } else if (ev.type === "command_written") {
          const command = ev.command as Record<string, unknown>;
          const unsupported = useAccountStore
            .getState()
            .applyAssistantCommand({ projectId, commandV1: command, lang });
          if (unsupported.length > 0) {
            toast.warning(
              t("assistant.unsupportedDropped", {
                id: String(command.id),
                list: [...new Set(unsupported)].join(", "),
              }),
            );
          }
          setEntries((e) => [...e, { role: "card", kind: "written", id: String(command.id) }]);
          dirty = true;
        } else if (ev.type === "command_deleted") {
          useAccountStore.getState().deleteFromProject({ projectId, nodeIds: [String(ev.id)] });
          setEntries((e) => [...e, { role: "card", kind: "deleted", id: String(ev.id) }]);
          dirty = true;
        } else if (ev.type === "dialog_written") {
          const dialog = ev.dialog as Record<string, unknown>;
          const unsupported = useAccountStore
            .getState()
            .applyAssistantDialog({ projectId, dialogV1: dialog, lang });
          if (unsupported.length > 0) {
            toast.warning(
              t("assistant.unsupportedDropped", {
                id: String(dialog.id),
                list: [...new Set(unsupported)].join(", "),
              }),
            );
          }
          setEntries((e) => [...e, { role: "card", kind: "written", id: String(dialog.id) }]);
          dirty = true;
        } else if (ev.type === "dialog_deleted") {
          useAccountStore.getState().deleteFromProject({ projectId, nodeIds: [String(ev.id)] });
          setEntries((e) => [...e, { role: "card", kind: "deleted", id: String(ev.id) }]);
          dirty = true;
        } else if (ev.type === "translations_written") {
          const entries = ev.entries as Record<string, Record<string, string>>;
          useAccountStore.getState().applyAssistantTranslations({ projectId, entries });
          setEntries((e) => [
            ...e,
            {
              role: "card",
              kind: "written",
              id: t("assistant.translationsCard", { count: Object.keys(entries).length }),
            },
          ]);
          dirty = true;
        } else if (ev.type === "credits") {
          setBalance((b) =>
            b
              ? { ...b, total: Number(ev.balance) }
              : { total: Number(ev.balance), subscription: 0, rollover: 0, topup: Number(ev.balance) },
          );
        } else if (ev.type === "insufficient_credits") {
          setOutOfCredits(true);
          setBalance((b) =>
            b
              ? { ...b, total: Number(ev.balance) }
              : { total: Number(ev.balance), subscription: 0, rollover: 0, topup: 0 },
          );
        } else if (ev.type === "error") {
          const msg = String(ev.message ?? t("assistant.errorGeneric"));
          toast.error(msg);
          setTurnError(msg);
        }
      }
      // AI writes must be durable immediately: the debounced auto-save would
      // lose a just-generated menu on a reload within its 2s window.
      if (dirty) {
        const updated = useAccountStore.getState().account.projects.find((p) => p.id === projectId);
        if (updated) await persistProject(updated, !!user).catch(() => {});
      }
    } catch (err) {
      // Keep the friendly line but never swallow the cause — "Interrompu"
      // with an empty console made a wire-shape 404 undiagnosable.
      console.error("[assistant] turn failed:", err);
      toast.error(t("assistant.errorGeneric"));
      setTurnError(t("assistant.interrupted"));
    } finally {
      setBusy(false);
      setActivity(null);
    }
  }

  async function addFiles(files: File[]) {
    if (files.length === 0) return;
    const next: Record<string, string> = { ...attachments };
    for (const file of files) next[file.name] = await file.text();
    setAttachments(next);
  }

  async function onDrop(e: React.DragEvent) {
    e.preventDefault();
    await addFiles(Array.from(e.dataTransfer?.files ?? []));
  }

  function removeAttachment(name: string) {
    setAttachments(({ [name]: _, ...rest }) => rest);
  }

  const fileInputRef = useRef<HTMLInputElement>(null);
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
            <div
              data-testid="assistant-thinking"
              className="flex items-center gap-1 text-[12px] text-[var(--text-mut)]"
            >
              <span>{t(activity ?? "assistant.thinking")}</span>
              <span aria-hidden className="animate-pulse">
                …
              </span>
            </div>
          )}
          {!busy && turnError && (
            <div data-testid="assistant-error" className="text-[12px] text-[var(--danger)]">
              ⚠️ {turnError}
            </div>
          )}
        </div>
      </div>

      {attachmentCount > 0 && (
        <div
          data-testid="assistant-attachments"
          className="flex shrink-0 flex-wrap gap-1.5 px-3 pb-2"
        >
          {Object.entries(attachments).map(([name, content]) => (
            <span key={name} className="chip cursor-default gap-1.5">
              <FileText className="h-3 w-3 shrink-0 text-[var(--text-mut)]" />
              <span className="max-w-[160px] truncate">{name}</span>
              <span className="text-[var(--text-faint)]">{formatBytes(content)}</span>
              <button
                type="button"
                aria-label={t("assistant.attachRemove", { name })}
                onClick={() => removeAttachment(name)}
                className="rounded-[4px] text-[var(--text-mut)] transition-colors hover:text-[var(--text)]"
              >
                <X className="h-3 w-3" />
              </button>
            </span>
          ))}
        </div>
      )}

      {outOfCredits && <OutOfCreditsNotice onGetCredits={() => navigate({ to: "/credits" })} />}

      <div className="flex shrink-0 flex-col gap-2 border-[var(--border-soft)] border-t p-3">
        <div data-testid="assistant-composer-toolbar" className="flex min-w-0 items-center gap-2">
          <ModelSelector
            value={modelId}
            onChange={setModelId}
            onModelsLoaded={(r) =>
              setModelId((cur) => cur ?? r.preferredModelId ?? r.defaultModelId)
            }
            className="min-w-0 flex-1"
          />
          <CreditIndicator balance={balance} onRecharge={() => navigate({ to: "/credits" })} />
        </div>

        <div className="flex items-end gap-2">
          <input
            ref={fileInputRef}
            data-testid="assistant-file-input"
            type="file"
            multiple
            className="hidden"
            onChange={(e) => {
              void addFiles(Array.from(e.target.files ?? []));
              e.target.value = "";
            }}
          />
          <button
            type="button"
            aria-label={t("assistant.attachFiles")}
            title={t("assistant.attachFiles")}
            onClick={() => fileInputRef.current?.click()}
            disabled={outOfCredits}
            className="btn btn-sm btn-ghost btn-icon shrink-0"
          >
            <Paperclip className="h-4 w-4" />
          </button>
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
            disabled={outOfCredits}
            className="min-h-[44px] flex-1 resize-none rounded-[10px] border border-[var(--border)] bg-[var(--surface-raised)] px-3 py-2 text-[13px] text-[var(--text)] outline-none focus:border-[var(--border-strong)] disabled:opacity-50"
          />
          <button
            type="button"
            disabled={outOfCredits || busy || (input.trim().length === 0 && attachmentCount === 0)}
            onClick={() => void send()}
            className="btn btn-sm btn-primary shrink-0"
          >
            {t("assistant.send")}
          </button>
        </div>
      </div>
    </div>
  );
}
