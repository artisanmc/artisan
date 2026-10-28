import { Button } from "@/components/ui/button";
import { ApiError } from "@/lib/api/client";
import { type ConsentParams, type ConsentRequest, answerConsent, getConsent } from "@/lib/api/mcp";
import { useAuthStore } from "@/state/authStore";
import { Bot, Check, X } from "lucide-react";
import { useEffect, useMemo, useState } from "react";
import { useTranslation } from "react-i18next";

/** How often the page looks for a sign-in made in another tab (the in-game link opens one). */
const SIGN_IN_POLL_MS = 4000;

/** The client's request, as `/oauth/authorize` forwarded it; null when a field is missing. */
export function consentParams(search: URLSearchParams): ConsentParams | null {
  const client_id = search.get("client_id");
  const redirect_uri = search.get("redirect_uri");
  const code_challenge = search.get("code_challenge");
  if (search.has("error") || !client_id || !redirect_uri || !code_challenge) return null;
  return { client_id, redirect_uri, code_challenge, state: search.get("state") ?? undefined };
}

/**
 * The player's yes or no to an AI client (ADR `mcp-server`). Signed in as in
 * the rest of the editor: the client never sees the session, only the code the
 * hub sends back to its address.
 */
export function ConsentPage({ query }: { query: string }) {
  const { t } = useTranslation();
  const user = useAuthStore((s) => s.currentUser);
  const params = useMemo(() => consentParams(new URLSearchParams(query)), [query]);
  const [request, setRequest] = useState<ConsentRequest | null | undefined>(undefined);
  const [busy, setBusy] = useState(false);
  const [failed, setFailed] = useState(false);
  const [leaving, setLeaving] = useState(false);

  // Signed out: the in-game link opens another tab; this one waits for the cookie.
  useEffect(() => {
    if (user) return;
    const timer = setInterval(() => void useAuthStore.getState().hydrate(), SIGN_IN_POLL_MS);
    return () => clearInterval(timer);
  }, [user]);

  useEffect(() => {
    if (!user || !params) return;
    let cancelled = false;
    getConsent(params)
      .then((r) => !cancelled && setRequest(r))
      .catch((e) => !cancelled && setRequest(e instanceof ApiError ? null : undefined));
    return () => {
      cancelled = true;
    };
  }, [user, params]);

  const answer = async (approve: boolean) => {
    if (!params) return;
    setBusy(true);
    setFailed(false);
    try {
      const redirect = await answerConsent(params, approve);
      setLeaving(true);
      window.location.assign(redirect);
    } catch {
      setFailed(true);
      setBusy(false);
    }
  };

  const body = () => {
    if (!params || request === null)
      return <p className="text-[13px] text-[var(--text-mut)]">{t("mcp.consent.invalid")}</p>;
    if (!user)
      return <p className="text-[13px] text-[var(--text-mut)]">{t("mcp.consent.signIn")}</p>;
    if (request === undefined)
      return <p className="text-[13px] text-[var(--text-mut)]">{t("mcp.apps.loading")}</p>;
    const host = request.client.redirectHost;
    if (leaving)
      return (
        <p className="text-[13px] text-[var(--text-mut)]">{t("mcp.consent.returning", { host })}</p>
      );
    return (
      <div className="flex flex-col gap-5">
        <p className="text-[14px] text-[var(--text)]">
          {t("mcp.consent.intro", { client: request.client.name, player: request.player })}
        </p>
        <div className="flex flex-col gap-2">
          <span className="field-label">{t("mcp.consent.can")}</span>
          <ul className="flex flex-col gap-1.5 text-[13px] text-[var(--text)]">
            {[t("mcp.consent.canRead"), t("mcp.consent.canDraft")].map((line) => (
              <li key={line} className="flex items-start gap-2">
                <Check className="mt-0.5 size-[14px] shrink-0 text-[var(--brand)]" />
                {line}
              </li>
            ))}
            <li className="flex items-start gap-2">
              <X className="mt-0.5 size-[14px] shrink-0 text-[var(--text-mut)]" />
              {t("mcp.consent.cannot")}
            </li>
          </ul>
        </div>
        <p className="text-[12px] text-[var(--text-mut)]">{t("mcp.consent.redirect", { host })}</p>
        {!request.canEdit && (
          <p className="text-[13px] text-[var(--danger)]">{t("mcp.consent.needEdit")}</p>
        )}
        {failed && <p className="text-[13px] text-[var(--danger)]">{t("mcp.consent.failed")}</p>}
        <div className="flex justify-end gap-2">
          <Button variant="outline" disabled={busy} onClick={() => void answer(false)}>
            {t("mcp.consent.deny")}
          </Button>
          <Button
            variant="primary"
            disabled={busy || !request.canEdit}
            onClick={() => void answer(true)}
          >
            {t("mcp.consent.approve")}
          </Button>
        </div>
      </div>
    );
  };

  return (
    <div className="grain relative flex min-h-screen items-center justify-center bg-[var(--surface)] p-8">
      <div aria-hidden className="page-glow pointer-events-none absolute inset-0" />
      <section className="card relative flex w-full max-w-[460px] flex-col gap-5 p-8">
        <header className="flex items-center gap-3">
          <Bot className="size-[22px] text-[var(--brand)]" />
          <h1 className="text-[20px] font-semibold text-[var(--text)]">
            {request
              ? t("mcp.consent.title", { client: request.client.name })
              : t("mcp.consent.titleGeneric")}
          </h1>
        </header>
        {body()}
      </section>
    </div>
  );
}
