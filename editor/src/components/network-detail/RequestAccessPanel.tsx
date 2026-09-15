import { type AccessOptions, getAccessOptions, requestAccess } from "@/lib/api/accessRequests";
import { useEffect, useState } from "react";
import { useTranslation } from "react-i18next";

type PanelState = "idle" | "sending" | "sent" | "already_pending" | "error";

interface Props {
  networkIdOrSlug: string;
  onAccessGranted?: () => void;
  pollIntervalMs?: number;
}

const reopenPage = () => window.location.reload();

export function RequestAccessPanel({
  networkIdOrSlug,
  onAccessGranted = reopenPage,
  pollIntervalMs = 3000,
}: Props) {
  const { t } = useTranslation();
  const [message, setMessage] = useState("");
  const [state, setState] = useState<PanelState>("idle");
  const [options, setOptions] = useState<AccessOptions | null>(null);
  const [loadError, setLoadError] = useState(false);
  const [copied, setCopied] = useState(false);

  useEffect(() => {
    const controller = new AbortController();
    let timer: ReturnType<typeof setTimeout>;
    setOptions(null);
    setLoadError(false);
    setState("idle");
    setCopied(false);
    const check = async () => {
      try {
        const next = await getAccessOptions(networkIdOrSlug, controller.signal);
        if (controller.signal.aborted) return;
        if (next.isMember) {
          onAccessGranted();
          return;
        }
        setOptions(next);
        setLoadError(false);
      } catch {
        if (controller.signal.aborted) return;
        setLoadError(true);
      }
      timer = setTimeout(check, pollIntervalMs);
    };
    void check();
    return () => {
      controller.abort();
      clearTimeout(timer);
    };
  }, [networkIdOrSlug, onAccessGranted, pollIntervalMs]);

  async function handleSubmit() {
    setState("sending");
    try {
      await requestAccess(networkIdOrSlug, message.trim() || undefined);
      setState("sent");
    } catch (err) {
      const status = (err as Error & { status?: number }).status;
      setState(
        status === 409 && (err as Error).message === "already_pending"
          ? "already_pending"
          : "error",
      );
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

        {!options ? (
          <output>{t(loadError ? "requestAccess.error" : "requestAccess.loading")}</output>
        ) : options.mode === "console" ? (
          <>
            <p className="text-[13px] leading-relaxed text-[var(--text-mut)]">
              {t("requestAccess.consoleDescription")}
            </p>
            <ul className="text-[13px] text-[var(--text-mut)]">
              {options.servers.map((server) => (
                <li key={server.id}>
                  {server.label || t("requestAccess.unnamedServer")} —{" "}
                  {t(server.online ? "requestAccess.online" : "requestAccess.offline")}
                </li>
              ))}
            </ul>
            <code className="input break-all whitespace-normal" style={{ height: "auto" }}>
              {options.command}
            </code>
            <button
              type="button"
              className="btn btn-sm btn-primary self-start"
              onClick={async () => {
                try {
                  await navigator.clipboard.writeText(options.command ?? "");
                  setCopied(true);
                } catch {
                  setCopied(false);
                  setState("error");
                }
              }}
            >
              {t(copied ? "requestAccess.copied" : "requestAccess.copyCommand")}
            </button>
            <output className="text-[13px] text-[var(--text-mut)]">
              {t(
                options.servers.some((s) => s.online)
                  ? "requestAccess.waitingConsole"
                  : "requestAccess.serverOffline",
              )}
            </output>
            {(loadError || state === "error") && (
              <p className="text-[13px] text-[var(--danger)]">{t("requestAccess.error")}</p>
            )}
          </>
        ) : state === "sent" ? (
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
