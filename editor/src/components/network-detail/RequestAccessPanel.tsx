import { requestAccess } from "@/lib/api/accessRequests";
import { useState } from "react";
import { useTranslation } from "react-i18next";

type PanelState = "idle" | "sending" | "sent" | "already_pending" | "error";

interface Props {
  networkIdOrSlug: string;
}

export function RequestAccessPanel({ networkIdOrSlug }: Props) {
  const { t } = useTranslation();
  const [message, setMessage] = useState("");
  const [state, setState] = useState<PanelState>("idle");

  async function handleSubmit() {
    setState("sending");
    try {
      await requestAccess(networkIdOrSlug, message.trim() || undefined);
      setState("sent");
    } catch (err) {
      const status = (err as Error & { status?: number }).status;
      setState(status === 409 ? "already_pending" : "error");
    }
  }

  return (
    <div className="flex h-full items-center justify-center p-8">
      <div className="card flex w-full max-w-sm flex-col gap-4 p-6">
        <h2
          className="display text-[20px] text-[var(--text)]"
          style={{ fontFamily: "var(--font-display)" }}
        >
          {t("requestAccess.title")}
        </h2>

        {state === "sent" ? (
          <p className="text-[13px] leading-relaxed text-[var(--text-mut)]">
            {t("requestAccess.sent")}
          </p>
        ) : state === "already_pending" ? (
          <p className="text-[13px] leading-relaxed text-[var(--text-mut)]">
            {t("requestAccess.alreadyPending")}
          </p>
        ) : (
          <>
            <p className="text-[13px] leading-relaxed text-[var(--text-mut)]">
              {t("requestAccess.description")}
            </p>
            <label className="flex flex-col gap-1 text-[12px]">
              <span className="text-[var(--text-mut)]">{t("requestAccess.messageLabel")}</span>
              <textarea
                className="input"
                rows={3}
                maxLength={500}
                value={message}
                onChange={(e) => setMessage(e.target.value)}
                placeholder={t("requestAccess.messagePlaceholder")}
              />
            </label>
            {state === "error" && (
              <p className="text-[12px] text-[var(--danger)]">{t("requestAccess.error")}</p>
            )}
            <button
              type="button"
              className="btn btn-sm btn-primary self-start"
              disabled={state === "sending"}
              onClick={handleSubmit}
            >
              {state === "sending" ? t("requestAccess.sending") : t("requestAccess.submit")}
            </button>
          </>
        )}
      </div>
    </div>
  );
}

export default RequestAccessPanel;
