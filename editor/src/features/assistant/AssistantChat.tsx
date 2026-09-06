import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import type { ProjectId } from "@/domain/types";
import { ModelSelector } from "@/features/assistant/ModelSelector";
import { OutOfCreditsNotice } from "@/features/assistant/OutOfCreditsNotice";
import { CreditIndicator } from "@/features/billing/CreditIndicator";
import {
  projectToCommandV1,
  projectToDialogV1,
  projectToMenuV1,
} from "@/features/export/transform";
import { getBalance } from "@/lib/api/aiUser";
import {
  type AssistantEvent,
  AssistantRequestError,
  type ConversationMessage,
  getConversation,
  openConversation,
  streamAssistant,
} from "@/lib/api/assistant";
import type { BalanceBreakdown } from "@/lib/api/billing";
import { useAccountStore } from "@/state/accountStore";
import { useAuthStore } from "@/state/authStore";
import { useNavigate } from "@tanstack/react-router";
import { ChevronLeft, FileText, LoaderCircle, Paperclip, X } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { toast } from "sonner";
import { type ServerAttachmentGroup, ServerImportSourceDialog } from "./ServerImportSourceDialog";

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
 * copy with `projectToMenuV1(project)` + `attachments`. Auth: a logged-in user
 * (cookie); see `lib/api/assistant.ts`.
 */
export function AssistantChat({
  projectId,
  conversationId = null,
  onBack,
  networkId,
  serverId,
  serverOnline = false,
}: {
  projectId: ProjectId;
  conversationId?: string | null;
  onBack?: () => void;
  networkId?: string;
  serverId?: string;
  serverOnline?: boolean;
}) {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const user = useAuthStore((s) => s.currentUser);

  const [entries, setEntries] = useState<Entry[]>([]);
  const [input, setInput] = useState("");
  const [busy, setBusy] = useState(false);
  const [preparingSend, setPreparingSend] = useState(false);
  const [activity, setActivity] = useState<string | null>(null);
  const [turnError, setTurnError] = useState<string | null>(null);
  const [attachments, setAttachments] = useState<Record<string, string>>({});
  const [serverGroups, setServerGroups] = useState<ServerAttachmentGroup[]>([]);
  const [serverDialogOpen, setServerDialogOpen] = useState(false);
  const [expandedGroups, setExpandedGroups] = useState<Set<string>>(new Set());
  const serverFileCount = serverGroups.reduce((count, group) => count + group.files.length, 0);
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
    const attachedNames = [
      ...Object.keys(attachments),
      ...serverGroups.flatMap((group) =>
        group.files.map((file) => `server:${group.sourceId}/${file.path}`),
      ),
    ];
    if (!user || (!text && attachedNames.length === 0) || busy) return;
    const shown = text || t("assistant.sentFiles", { names: attachedNames.join(", ") });
    setBusy(true);
    setPreparingSend(true);
    setActivity(null);
    setTurnError(null);
    try {
      const project = useAccountStore.getState().account.projects.find((p) => p.id === projectId);
      const lang = project?.defaultLang ?? "en";
      const menus = project ? projectToMenuV1(project) : [];
      const commands = project ? projectToCommandV1(project) : [];
      const dialogs = project ? projectToDialogV1(project) : [];
      // Translation values behind the {i18n:<key>} refs — without them the
      // model can see the refs but never the actual text.
      const translations = project ? project.i18nKeys : {};
      // Les sources du project, pour que l'assistant cesse de deviner si un
      // `source.ref` existe. Celles déclarées par les modules du serveur, il les
      // lit côté backend — l'éditeur n'a pas à les rapatrier pour les renvoyer.
      const dataSources = (project?.dataSources ?? []).map((ds) => ({
        ref: `pack:${ds.id}`,
        keyField: (ds as { keyField?: string }).keyField ?? null,
        fields: (ds as { schema?: { name: string; type?: string }[] }).schema,
      }));
      if (!convId.current) {
        convId.current = await openConversation({ projectId });
      }
      const stream = streamAssistant(convId.current, {
        text,
        menus,
        attachments,
        serverAttachments: serverGroups.map((group) => ({
          sourceId: group.sourceId,
          paths: group.files.map((file) => file.path).sort(),
        })),
        commands,
        dialogs,
        translations,
        dataSources,
        modelId: modelId ?? undefined,
      });
      const first = await stream.next();
      setPreparingSend(false);
      if (first.done || first.value.type !== "insufficient_credits") {
        setInput("");
        setAttachments({});
        setServerGroups([]);
        setExpandedGroups(new Set());
        setEntries((e) => [...e, { role: "user", text: shown }]);
      }
      function handleAssistantEvent(ev: AssistantEvent) {
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
        } else if (ev.type === "menu_deleted") {
          useAccountStore.getState().deleteFromProject({ projectId, nodeIds: [String(ev.id)] });
          setEntries((e) => [...e, { role: "card", kind: "deleted", id: String(ev.id) }]);
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
        } else if (ev.type === "command_deleted") {
          useAccountStore.getState().deleteFromProject({ projectId, nodeIds: [String(ev.id)] });
          setEntries((e) => [...e, { role: "card", kind: "deleted", id: String(ev.id) }]);
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
        } else if (ev.type === "dialog_deleted") {
          useAccountStore.getState().deleteFromProject({ projectId, nodeIds: [String(ev.id)] });
          setEntries((e) => [...e, { role: "card", kind: "deleted", id: String(ev.id) }]);
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
        } else if (ev.type === "credits") {
          setBalance((b) =>
            b
              ? { ...b, total: Number(ev.balance) }
              : {
                  total: Number(ev.balance),
                  subscription: 0,
                  rollover: 0,
                  topup: Number(ev.balance),
                },
          );
        } else if (ev.type === "insufficient_credits") {
          setOutOfCredits(true);
          setBalance((b) =>
            b
              ? { ...b, total: Number(ev.balance) }
              : { total: Number(ev.balance), subscription: 0, rollover: 0, topup: 0 },
          );
        } else if (ev.type === "error") {
          const msg =
            ev.code === "attachments_not_read"
              ? t("assistant.attachmentsNotRead", { read: ev.readCount, total: ev.totalCount })
              : String(ev.message ?? t("assistant.errorGeneric"));
          toast.error(msg);
          setTurnError(msg);
        }
      }
      if (!first.done) handleAssistantEvent(first.value);
      for await (const event of stream) handleAssistantEvent(event);
      // Ce que l'assistant génère atterrit dans l'état de la page, comme une
      // édition manuelle : rien n'est écrit sur le serveur sans que l'admin
      // clique sur Enregistrer (ADR `server-disk-only-storage`, décision 3).
      // Écrire ici serait le seul chemin du produit qui touche le disque sans
      // geste — et le plus surprenant, puisqu'il n'est pas de l'admin.
    } catch (err) {
      // Keep the friendly line but never swallow the cause — "Interrompu"
      // with an empty console made a wire-shape 404 undiagnosable.
      console.error("[assistant] turn failed:", err);
      const message =
        err instanceof AssistantRequestError
          ? t(`assistant.serverFiles.errors.${err.code}`, {
              defaultValue: t("assistant.serverFiles.errors.read_error"),
            })
          : t("assistant.interrupted");
      toast.error(message);
      setTurnError(message);
    } finally {
      setBusy(false);
      setPreparingSend(false);
      setActivity(null);
    }
  }

  async function addFiles(files: File[]) {
    if (files.length === 0 || busy) return;
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
          {busy && !preparingSend && (
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
                disabled={busy}
                onClick={() => removeAttachment(name)}
                className="rounded-[4px] text-[var(--text-mut)] transition-colors hover:text-[var(--text)]"
              >
                <X className="h-3 w-3" />
              </button>
            </span>
          ))}
        </div>
      )}

      {serverGroups.length > 0 && (
        <div
          data-testid="assistant-server-attachments"
          className="flex shrink-0 flex-col gap-1.5 px-3 pb-2"
        >
          {serverGroups.map((group) => (
            <div key={group.sourceId}>
              <span className="chip gap-1.5">
                <button
                  type="button"
                  disabled={busy}
                  aria-expanded={expandedGroups.has(group.sourceId)}
                  aria-label={t(
                    expandedGroups.has(group.sourceId)
                      ? "assistant.serverFiles.collapse"
                      : "assistant.serverFiles.expand",
                    { name: group.label },
                  )}
                  onClick={() =>
                    setExpandedGroups((current) => {
                      const next = new Set(current);
                      if (next.has(group.sourceId)) next.delete(group.sourceId);
                      else next.add(group.sourceId);
                      return next;
                    })
                  }
                >
                  {t("assistant.serverFiles.group", {
                    name: group.label,
                    count: group.files.length,
                  })}
                </button>
                <button
                  type="button"
                  disabled={busy}
                  aria-label={t("assistant.serverFiles.remove", { name: group.label })}
                  onClick={() =>
                    setServerGroups((current) =>
                      current.filter((item) => item.sourceId !== group.sourceId),
                    )
                  }
                >
                  <X className="size-3" />
                </button>
              </span>
              {expandedGroups.has(group.sourceId) && (
                <ul className="px-3 py-1 text-xs text-[var(--text-mut)]">
                  {group.files.map((file) => (
                    <li key={file.path}>{file.path}</li>
                  ))}
                </ul>
              )}
            </div>
          ))}
        </div>
      )}
      {networkId && serverId && (
        <ServerImportSourceDialog
          open={serverDialogOpen && serverOnline}
          onOpenChange={setServerDialogOpen}
          networkId={networkId}
          serverId={serverId}
          projectId={projectId}
          existingGroups={serverGroups}
          onAttach={setServerGroups}
        />
      )}

      {outOfCredits && <OutOfCreditsNotice onGetCredits={() => navigate({ to: "/credits" })} />}

      <div className="flex shrink-0 flex-col gap-2 border-[var(--border-soft)] border-t p-3">
        {preparingSend && (
          <output
            data-testid="assistant-send-status"
            className="flex items-center gap-2 text-[12px] text-[var(--text-mut)]"
          >
            <LoaderCircle aria-hidden className="h-3.5 w-3.5 shrink-0 animate-spin" />
            <span>
              {t(
                serverFileCount + attachmentCount > 0
                  ? "assistant.sendingFiles"
                  : "assistant.preparingSend",
              )}
            </span>
          </output>
        )}
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
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <button
                type="button"
                aria-label={t("assistant.attachFiles")}
                title={t("assistant.attachFiles")}
                disabled={outOfCredits || busy}
                className="btn btn-sm btn-ghost btn-icon shrink-0"
              >
                <Paperclip className="h-4 w-4" />
              </button>
            </DropdownMenuTrigger>
            <DropdownMenuContent>
              <DropdownMenuItem onSelect={() => fileInputRef.current?.click()}>
                {t("assistant.serverFiles.fromDevice")}
              </DropdownMenuItem>
              <DropdownMenuItem
                disabled={!serverOnline || !networkId || !serverId}
                onSelect={() => setServerDialogOpen(true)}
              >
                <span>
                  {t("assistant.serverFiles.fromServer")}
                  {!serverOnline && (
                    <span className="block text-xs">
                      {t("assistant.serverFiles.server_offline")}
                    </span>
                  )}
                </span>
              </DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>
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
            disabled={outOfCredits || busy}
            className="min-h-[44px] flex-1 resize-none rounded-[10px] border border-[var(--border)] bg-[var(--surface-raised)] px-3 py-2 text-[13px] text-[var(--text)] outline-none focus:border-[var(--border-strong)] disabled:opacity-50"
          />
          <button
            type="button"
            disabled={
              outOfCredits ||
              busy ||
              (input.trim().length === 0 && attachmentCount === 0 && serverFileCount === 0)
            }
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
