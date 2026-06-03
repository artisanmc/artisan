import { createFileRoute, redirect, useNavigate } from "@tanstack/react-router";
import { type RefObject, useEffect, useRef, useState } from "react";
import { useTranslation, Trans } from "react-i18next";
import { exchangeEditorSession, validateEditorSession, refreshEditorSession } from "@/lib/editorSession";
import { EditorWs } from "@/lib/editorWs";
import { loadPacks, savePack } from "@/lib/packApi";
import { transform } from "@/features/export/transform";
import { useAccountStore } from "@/state/accountStore";
import { useAuthStore } from "@/state/authStore";
import { useSessionStore } from "@/state/sessionStore";
import { TrustGatePage } from "@/features/trust/TrustGatePage";
import type { PackId, AccountId } from "@/domain/types";

export const Route = createFileRoute("/session")({
  // A logged-in user-auth user who opens /session WITHOUT a token in the URL
  // has nothing to do here — the "Session expirée" panel reads as a broken
  // state when really they just never started the trust dance. Bounce them
  // to /networks. If they DO have a token (?token=...), they're coming from
  // /artisan editor in MC console and need to complete the trust dance, so
  // we let the component mount in that case.
  beforeLoad: ({ search }) => {
    const hasToken = Boolean((search as { token?: string } | undefined)?.token);
    if (hasToken) return;
    const user = useAuthStore.getState().currentUser;
    if (user) throw redirect({ to: "/networks" });
  },
  component: SessionPage,
});

function SessionPage() {
  const { t } = useTranslation();
  const tokenRef = useRef<string | null>(null);
  const [state, setState] = useState<"loading" | "invalid" | "expired" | "already_used" | "empty" | "trust_gate">("loading");
  const [draftNotice, setDraftNotice] = useState<string | null>(null);
  const [networkId, setNetworkId] = useState<string | null>(null);
  const wsRef = useRef<EditorWs | null>(null);
  const refreshRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const mountedRef = useRef(true);
  const pendingPackIdRef = useRef<string | null>(null);
  const navigate = useNavigate();
  const setSession = useSessionStore((s) => s.setSession);
  const clearSession = useSessionStore((s) => s.clearSession);
  const setTrusted = useSessionStore((s) => s.setTrusted);
  const trustCode = useSessionStore((s) => s.trustCode);

  useEffect(() => {
    mountedRef.current = true;

    const params = new URLSearchParams(window.location.search);
    const urlToken = params.get("token");

    (async () => {
      try {
        let accessToken: string;

        if (urlToken) {
          // Fresh link — exchange the one-time url token
          history.replaceState({}, "", "/session");
          try {
            const result = await exchangeEditorSession(urlToken);
            accessToken = result.access_token;
          } catch (e) {
            if (!mountedRef.current) return;
            setState(e instanceof Error && e.message === "already_used" ? "already_used" : "invalid");
            return;
          }
        } else {
          // Page refresh — try cookie-based refresh
          const newToken = await refreshEditorSession();
          if (!newToken) {
            if (mountedRef.current) setState("expired");
            return;
          }
          accessToken = newToken;
        }

        if (!mountedRef.current) return;
        tokenRef.current = accessToken;

        const info = await validateEditorSession(accessToken);
        if (!mountedRef.current) return;
        const trustCode = info.trust_code;
        setNetworkId(info.network_id);

        const packs = await loadPacks(accessToken);
        if (!mountedRef.current) return;

        // Merge session packs into the existing accountStore instead of
        // replacing it — without this, a user who created packs via the
        // web UI before running /artisan setup would see their work wiped
        // the moment a session arrived. Session packs upsert by id;
        // existing user-mode packs (not bound to this server_key yet)
        // stay reachable from the sidebar.
        const current = useAccountStore.getState().account;
        const byId = new Map(current.packs.map((p) => [p.id, p]));
        for (const p of packs) byId.set(p.id, p);
        const mergedPacks = Array.from(byId.values());
        const existingOrder = current.packOrder;
        const mergedOrder = [
          ...existingOrder,
          ...packs.map((p) => p.id as PackId).filter((id) => !existingOrder.includes(id)),
        ];
        useAccountStore.getState().setAccount({
          id: info.server_key_id as AccountId,
          packs: mergedPacks,
          packOrder: mergedOrder,
        });

        setSession(accessToken, info.server_key_id, info.network_id, trustCode, info.trusted);

        wsRef.current = new EditorWs(
          accessToken,
          (_packId, menuId, _menuYaml, _updatedBy) => {
            if (!mountedRef.current) return;
            setDraftNotice(t("sessionPage.draftConflict", { menuId }));
            setTimeout(() => setDraftNotice(null), 5000);
          },
          () => {
            if (!mountedRef.current) return;
            clearSession();
            setState("expired");
          },
          () => {
            if (!mountedRef.current) return;
            setTrusted(true);
            const packId = pendingPackIdRef.current;
            if (packId) {
              navigate({ to: "/workspace/$workspaceId", params: { workspaceId: packId } });
            } else {
              setState("empty");
            }
          },
        );

        // Silent refresh every 4 minutes
        refreshRef.current = setInterval(async () => {
          const newToken = await refreshEditorSession();
          if (!newToken) { clearSession(); setState("expired"); return; }
          tokenRef.current = newToken;
          setSession(newToken, info.server_key_id, info.network_id, trustCode, useSessionStore.getState().trusted);
        }, 4 * 60 * 1000);

        const firstPack = packs[0];
        if (!info.trusted) {
          pendingPackIdRef.current = firstPack?.id ?? null;
          setState("trust_gate");
        } else if (firstPack) {
          await navigate({ to: "/workspace/$workspaceId", params: { workspaceId: firstPack.id } });
        } else {
          setState("empty");
        }
      } catch {
        if (mountedRef.current) {
          clearSession();
          setState("invalid");
        }
      }
    })();

    return () => {
      mountedRef.current = false;
      wsRef.current?.disconnect();
      if (refreshRef.current) clearInterval(refreshRef.current);
    };
  }, [navigate, setSession, clearSession, setTrusted]);

  if (state === "invalid") {
    return (
      <SessionMessage
        tone="brick"
        title={t("sessionPage.invalid")}
        hintKey="sessionPage.invalidHint"
      />
    );
  }

  if (state === "already_used") {
    return (
      <SessionMessage
        tone="brick"
        title={t("sessionPage.alreadyUsed")}
        hintKey="sessionPage.invalidHint"
      />
    );
  }

  if (state === "expired") {
    return (
      <SessionMessage
        tone="gold"
        title={t("sessionPage.expired")}
        hintKey="sessionPage.expiredHint"
      />
    );
  }

  if (state === "empty") {
    return <EmptyState tokenRef={tokenRef} navigate={navigate} />;
  }

  if (state === "trust_gate") {
    return <TrustGatePage trustCode={trustCode ?? ""} />;
  }

  return (
    <div className="flex min-h-screen items-center justify-center bg-[var(--bg)]">
      {draftNotice && (
        <div
          className="fixed top-4 right-4 z-50 flex items-center gap-2 rounded-[14px] border border-[var(--gold-soft)] bg-[var(--card-surface)] px-4 py-2.5 text-[13px] text-[var(--gold)]"
          style={{ boxShadow: "var(--sh-2)" }}
        >
          <span className="dot" style={{ background: "var(--gold)" }} />
          {draftNotice}
        </div>
      )}
      <p className="text-[var(--ink-mut)]">{t("sessionPage.loading")}</p>
    </div>
  );
}

function SessionMessage({
  title,
  hintKey,
  tone,
}: {
  title: string;
  hintKey: "sessionPage.invalidHint" | "sessionPage.expiredHint";
  tone: "brick" | "gold";
}) {
  const { t } = useTranslation();
  const accent = tone === "brick" ? "var(--brick)" : "var(--gold)";
  return (
    <div className="grain relative flex min-h-screen items-center justify-center bg-[var(--bg)] p-8">
      <div className="card relative z-[1] flex w-full max-w-md flex-col gap-4 p-7">
        <div className="flex items-center gap-2.5">
          <span className="dot" style={{ background: accent }} />
          <span className="text-[10.5px] font-semibold uppercase tracking-[.18em] text-[var(--ink-mut)]">
            {t("sessionPage.eyebrow")}
          </span>
        </div>
        <h1
          className="display text-[24px] tracking-tight text-[var(--ink)]"
          style={{ fontFamily: "var(--font-display)" }}
        >
          {title}
        </h1>
        <p className="text-[13.5px] leading-relaxed text-[var(--ink-mut)]">
          <Trans
            i18nKey={hintKey}
            components={{
              1: (
                <code className="mono rounded bg-[var(--inset)] px-1.5 py-0.5 text-[var(--sand)]" />
              ),
            }}
            values={{ cmd: "/artisan editor" }}
          />
        </p>
      </div>
    </div>
  );
}

function EmptyState({
  tokenRef,
  navigate,
}: {
  tokenRef: RefObject<string | null>;
  navigate: ReturnType<typeof useNavigate>;
}) {
  const { t } = useTranslation();
  const [id, setId] = useState("");
  const [busy, setBusy] = useState(false);
  const createPack = useAccountStore((s) => s.createPack);

  const submit = async () => {
    const trimmed = id.trim();
    if (!trimmed || busy) return;
    setBusy(true);
    try {
      const packId = createPack({ id: trimmed });
      const pack = useAccountStore.getState().account.packs.find((p) => p.id === packId)!;
      const files = transform(pack);
      await savePack(tokenRef.current!, pack, files);
      await navigate({ to: "/workspace/$workspaceId", params: { workspaceId: packId } });
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="grain relative flex min-h-screen items-center justify-center bg-[var(--bg)] p-8">
      <div className="card relative z-[1] flex w-full max-w-md flex-col gap-5 p-7">
        <div className="flex items-center gap-2.5">
          <span className="pixel-mark">
            <i /><i /><i /><i /><i /><i /><i /><i /><i />
          </span>
          <span className="text-[10.5px] font-semibold uppercase tracking-[.18em] text-[var(--ink-mut)]">
            {t("sessionPage.firstPackEyebrow")}
          </span>
        </div>
        <h1
          className="display text-[24px] tracking-tight text-[var(--ink)]"
          style={{ fontFamily: "var(--font-display)" }}
        >
          {t("sessionPage.noPack")}
        </h1>
        <p className="text-[13.5px] leading-relaxed text-[var(--ink-mut)]">
          {t("sessionPage.noPackBody")}
        </p>
        <div className="flex flex-col gap-2">
          <span className="field-label">{t("sessionPage.idLabel")}</span>
          <div className="flex gap-2">
            <input
              className="input"
              placeholder="my_pack"
              value={id}
              onChange={(e) => setId(e.target.value)}
              onKeyDown={(e) => { if (e.key === "Enter") submit(); }}
              autoFocus
            />
            <button
              type="button"
              onClick={submit}
              disabled={!id.trim() || busy}
              className="btn btn-primary"
            >
              {t("sessionPage.create")}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
