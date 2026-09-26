import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import { useAuthStore } from "@/state/authStore";
import {
  fetchInvitePreview,
  acceptInvite,
  AcceptInviteError,
  type InvitePreview,
} from "@/lib/api/invites";

export const Route = createFileRoute("/invite")({ component: InviteRoute });

type ViewState =
  | "loading"
  | "not_found"
  | "limit"
  | "error"
  | { kind: "preview"; data: InvitePreview }
  | { kind: "already_member"; networkId: string };

function InviteRoute() {
  const { t } = useTranslation();
  const currentUser = useAuthStore((s) => s.currentUser);
  const isAuthLoading = useAuthStore((s) => s.isLoading);
  const navigate = useNavigate();
  const code = new URLSearchParams(window.location.search).get("code");
  const [state, setState] = useState<ViewState>("loading");
  const [accepting, setAccepting] = useState(false);

  useEffect(() => {
    if (!code) {
      setState("not_found");
      return;
    }
    fetchInvitePreview(code)
      .then((r) => {
        setState(r === "not_found" ? "not_found" : { kind: "preview", data: r });
      })
      .catch(() => setState("error"));
  }, [code]);

  async function handleAccept() {
    if (!code) return;
    setAccepting(true);
    try {
      const result = await acceptInvite(code);
      if (result.alreadyMember) {
        setState({ kind: "already_member", networkId: result.networkId });
      } else {
        navigate({ to: "/networks/$networkId", params: { networkId: result.networkId } });
      }
    } catch (err) {
      if (err instanceof AcceptInviteError) {
        if (err.code === "collaborator_limit_reached") {
          setState("limit");
        } else if (err.code === "revoked" || err.code === "expired" || err.code === "exhausted") {
          setState({
            kind: "preview",
            data: { status: err.code, networkName: null, role: "" },
          });
        } else {
          setState("error");
        }
      } else {
        setState("error");
      }
    } finally {
      setAccepting(false);
    }
  }

  function handleLogin() {
    navigate({ to: "/login", search: { next: `/invite?code=${code ?? ""}` } });
  }

  return (
    <Shell>
      {state === "loading" && <SimpleCard label={t("invitePage.loading")} />}
      {state === "not_found" && <SimpleCard tone="brick" title={t("invitePage.notFound")} />}
      {state === "error" && <SimpleCard tone="brick" title={t("invitePage.error")} />}
      {state === "limit" && <SimpleCard tone="brick" title={t("invitePage.limit")} />}

      {typeof state === "object" && state.kind === "already_member" && (
        <div className="card flex flex-col gap-4 p-7">
          <h1 className="display text-[22px] tracking-tight text-[var(--text)]">
            {t("invitePage.alreadyMember")}
          </h1>
          <div className="flex justify-end pt-2">
            <button
              className="btn btn-primary"
              onClick={() =>
                navigate({ to: "/networks/$networkId", params: { networkId: state.networkId } })
              }
            >
              {t("invitePage.goToNetwork")}
            </button>
          </div>
        </div>
      )}

      {typeof state === "object" && state.kind === "preview" && (
        <div className="card flex flex-col gap-4 p-7">
          <div className="flex items-center gap-2.5">
            <span className="dot" style={{ background: "var(--brand)" }} />
            <span className="text-[10.5px] font-semibold uppercase tracking-[.18em] text-[var(--text-mut)]">
              {t("invitePage.eyebrow")}
            </span>
          </div>

          {state.data.status === "valid" && (
            <>
              <h1
                className="display text-[24px] tracking-tight text-[var(--text)]"
                style={{ fontFamily: "var(--font-display)" }}
              >
                {t("invitePage.title", { name: state.data.networkName ?? "" })}
              </h1>
              <p className="text-[14px] leading-relaxed text-[var(--text-mut)]">
                {t("invitePage.roleLabel", { role: t(`invitePage.role.${state.data.role}`, state.data.role) })}
              </p>

              {isAuthLoading ? null : currentUser ? (
                <div className="flex justify-end pt-2">
                  <button className="btn btn-primary" disabled={accepting} onClick={handleAccept}>
                    {t("invitePage.join", { name: state.data.networkName ?? "" })}
                  </button>
                </div>
              ) : (
                <div className="flex justify-end pt-2">
                  <button className="btn btn-primary" onClick={handleLogin}>
                    {t("invitePage.loginCta")}
                  </button>
                </div>
              )}
            </>
          )}

          {state.data.status === "revoked" && (
            <h1 className="display text-[22px] tracking-tight text-[var(--text)]">
              {t("invitePage.revoked")}
            </h1>
          )}
          {state.data.status === "expired" && (
            <h1 className="display text-[22px] tracking-tight text-[var(--text)]">
              {t("invitePage.expired")}
            </h1>
          )}
          {state.data.status === "exhausted" && (
            <h1 className="display text-[22px] tracking-tight text-[var(--text)]">
              {t("invitePage.exhausted")}
            </h1>
          )}
        </div>
      )}
    </Shell>
  );
}

function Shell({ children }: { children: React.ReactNode }) {
  return (
    <div className="grain relative flex min-h-screen items-center justify-center bg-[var(--surface)] p-8">
      <div
        aria-hidden
        className="pointer-events-none absolute inset-0"
        style={{
          background:
            "radial-gradient(80% 60% at 50% 0%, rgba(223,107,65,.06), transparent 60%)",
        }}
      />
      <div className="relative z-[1] w-full max-w-md">{children}</div>
    </div>
  );
}

function SimpleCard({
  title,
  label,
  tone,
}: {
  title?: string;
  label?: string;
  tone?: "brick" | "sage";
}) {
  const { t } = useTranslation();
  const accent = tone === "sage" ? "var(--success)" : tone === "brick" ? "var(--danger)" : "var(--text-mut)";
  return (
    <div className="card flex flex-col gap-3 p-7">
      <div className="flex items-center gap-2.5">
        <span className="dot" style={{ background: accent }} />
        <span className="text-[10.5px] font-semibold uppercase tracking-[.18em] text-[var(--text-mut)]">
          {t("invitePage.eyebrow")}
        </span>
      </div>
      {title && (
        <h1
          className="display text-[22px] tracking-tight text-[var(--text)]"
          style={{ fontFamily: "var(--font-display)" }}
        >
          {title}
        </h1>
      )}
      {label && <p className="text-[13.5px] text-[var(--text-mut)]">{label}</p>}
    </div>
  );
}

export default InviteRoute;
