import { relTime } from "@/components/LinkedServersDropdown";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  type EditorSessionInfo,
  listEditorSessions,
  revokeEditorSession,
} from "@/lib/api/editorSessions";
import { useAuthStore } from "@/state/authStore";
import { useEffect, useState } from "react";
import { useTranslation } from "react-i18next";

const RIGHTS = [
  "artisan.editor.view",
  "artisan.editor.edit",
  "artisan.editor.publish",
  "artisan.editor.config",
] as const;

function fetchSessions(set: (sessions: EditorSessionInfo[] | "failed") => void) {
  listEditorSessions()
    .then(set)
    .catch(() => set("failed"));
}

/** The hub writes a session's activity at most once an hour: below that, "within the hour". */
const HOUR = 60 * 60 * 1000;

/**
 * The open editor sessions of every server of the database, for those who
 * configure the editor: who, from which server, active when, with a tab open
 * here or not. Each one closes at once; one's own signs out.
 */
export function EditorSessionsSection() {
  const { t, i18n } = useTranslation();
  const [sessions, setSessions] = useState<EditorSessionInfo[] | "failed" | undefined>(undefined);
  const [failed, setFailed] = useState(false);

  const load = () => fetchSessions(setSessions);
  useEffect(() => fetchSessions(setSessions), []);

  const date = (iso: string) =>
    new Date(iso).toLocaleDateString(i18n.language, { day: "numeric", month: "short" });

  const active = (session: EditorSessionInfo) =>
    session.online
      ? t("editorSessions.online")
      : Date.now() - new Date(session.lastActiveAt).getTime() < HOUR
        ? t("editorSessions.activeRecent")
        : t("editorSessions.active", { when: relTime(session.lastActiveAt, i18n.language) });

  const revoke = async (session: EditorSessionInfo) => {
    if (session.current && !window.confirm(t("editorSessions.revokeSelfConfirm"))) return;
    setFailed(false);
    try {
      await revokeEditorSession(session.id);
      if (session.current) return void useAuthStore.getState().sessionClosed();
      setSessions((current) =>
        Array.isArray(current) ? current.filter((s) => s.id !== session.id) : current,
      );
    } catch {
      setFailed(true);
    }
  };

  if (sessions === undefined)
    return <p className="text-[13px] text-[var(--text-mut)]">{t("editorSessions.loading")}</p>;
  if (sessions === "failed")
    return <p className="text-[13px] text-[var(--danger)]">{t("editorSessions.failed")}</p>;

  return (
    <section className="flex flex-col gap-4">
      <div className="flex justify-end">
        <Button variant="outline" size="sm" onClick={load}>
          {t("editorSessions.refresh")}
        </Button>
      </div>
      {sessions.length === 0 ? (
        <p className="text-[13px] text-[var(--text-mut)]">{t("editorSessions.empty")}</p>
      ) : (
        <ul className="flex flex-col gap-2">
          {sessions.map((session) => (
            <li key={session.id} className="card flex items-center justify-between gap-4 p-4">
              <div className="flex min-w-0 flex-col gap-1">
                <div className="flex flex-wrap items-center gap-2">
                  <span className="truncate text-[14px] font-semibold text-[var(--text)]">
                    {session.playerName}
                  </span>
                  {session.current && <Badge variant="amber">{t("editorSessions.you")}</Badge>}
                  {session.online && <Badge variant="sage">{t("editorSessions.online")}</Badge>}
                </div>
                <span className="text-[12px] text-[var(--text-mut)]">
                  {[
                    active(session),
                    session.serverLabel || session.serverId
                      ? t("editorSessions.server", {
                          server: session.serverLabel ?? session.serverId,
                        })
                      : null,
                    session.createdAt
                      ? t("editorSessions.since", { date: date(session.createdAt) })
                      : null,
                  ]
                    .filter(Boolean)
                    .join(" · ")}
                </span>
                <span className="text-[12px] text-[var(--text-mut)]">
                  {RIGHTS.filter((r) => session.permissions.includes(r))
                    .map((r) => t(`editorSessions.rights.${r}`))
                    .join(", ")}
                </span>
              </div>
              <Button variant="destructive" size="sm" onClick={() => void revoke(session)}>
                {session.current ? t("editorSessions.revokeSelf") : t("editorSessions.revoke")}
              </Button>
            </li>
          ))}
        </ul>
      )}
      {failed && (
        <p className="text-[13px] text-[var(--danger)]">{t("editorSessions.revokeFailed")}</p>
      )}
    </section>
  );
}
