import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { useTranslation, Trans } from "react-i18next";
import { useAuthStore } from "@/state/authStore";
import {
  getNetworkTransfer,
  acceptNetworkTransfer,
  type TransferInfo,
  type TransferState,
} from "@/lib/api/networks";

export const Route = createFileRoute("/transfer")({ component: TransferRoute });

type ViewState = "loading" | TransferInfo | "expired" | "consumed" | "not_found" | "accepted" | "error";

function TransferRoute() {
  const { t } = useTranslation();
  const currentUser = useAuthStore((s) => s.currentUser);
  const isAuthLoading = useAuthStore((s) => s.isLoading);
  const navigate = useNavigate();
  const token = new URLSearchParams(window.location.search).get("token");
  const [state, setState] = useState<ViewState>("loading");

  useEffect(() => {
    if (isAuthLoading) return;
    if (!currentUser) {
      navigate({ to: "/login", search: { next: `/transfer?token=${token}` } });
      return;
    }
    if (!token) {
      setState("not_found");
      return;
    }
    getNetworkTransfer(token)
      .then((r: TransferState) => setState(r))
      .catch(() => setState("error"));
  }, [currentUser, isAuthLoading, token, navigate]);

  return (
    <Shell>
      {state === "loading" && <SimpleCard label={t("transferPage.loading")} />}
      {state === "expired" && <SimpleCard tone="brick" title={t("transferPage.expired")} />}
      {state === "consumed" && <SimpleCard tone="brick" title={t("transferPage.consumed")} />}
      {state === "not_found" && <SimpleCard tone="brick" title={t("transferPage.notFound")} />}
      {state === "error" && <SimpleCard tone="brick" title={t("transferPage.error")} />}
      {state === "accepted" && (
        <SimpleCard
          tone="sage"
          title={t("transferPage.accepted")}
          label={t("transferPage.redirecting")}
        />
      )}

      {typeof state === "object" && (
        <div className="card flex flex-col gap-4 p-7">
          <div className="flex items-center gap-2.5">
            <span className="dot" style={{ background: "var(--terra)" }} />
            <span className="text-[10.5px] font-semibold uppercase tracking-[.18em] text-[var(--ink-mut)]">
              {t("transferPage.eyebrow")}
            </span>
          </div>
          <h1
            className="display text-[24px] tracking-tight text-[var(--ink)]"
            style={{ fontFamily: "var(--font-display)" }}
          >
            {t("transferPage.title")}
          </h1>
          <p className="text-[14px] leading-relaxed text-[var(--ink-2)]">
            <Trans
              i18nKey="transferPage.body"
              components={{ 1: <strong className="text-[var(--terra)]" /> }}
              values={{ name: state.networkName }}
            />
          </p>
          <div className="flex items-center gap-2 text-[12px] text-[var(--ink-mut)]">
            <span className="badge">
              {t("transferPage.packCount", { count: state.packCount })}
            </span>
            <span>·</span>
            <span className="badge">
              {t("transferPage.serverKeyCount", { count: state.serverKeyCount })}
            </span>
          </div>
          <div className="flex justify-end pt-2">
            <button
              onClick={async () => {
                if (!token) return;
                try {
                  const result = await acceptNetworkTransfer(token);
                  setState("accepted");
                  setTimeout(() => {
                    navigate({
                      to: "/networks/$networkId",
                      params: { networkId: result.networkId },
                    });
                  }, 1500);
                } catch {
                  setState("error");
                }
              }}
              className="btn btn-primary"
            >
              {t("transferPage.accept")}
            </button>
          </div>
        </div>
      )}
    </Shell>
  );
}

function Shell({ children }: { children: React.ReactNode }) {
  return (
    <div className="grain relative flex min-h-screen items-center justify-center bg-[var(--bg)] p-8">
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
  const accent = tone === "sage" ? "var(--sage)" : tone === "brick" ? "var(--brick)" : "var(--ink-mut)";
  return (
    <div className="card flex flex-col gap-3 p-7">
      <div className="flex items-center gap-2.5">
        <span className="dot" style={{ background: accent }} />
        <span className="text-[10.5px] font-semibold uppercase tracking-[.18em] text-[var(--ink-mut)]">
          {t("transferPage.eyebrow")}
        </span>
      </div>
      {title && (
        <h1
          className="display text-[22px] tracking-tight text-[var(--ink)]"
          style={{ fontFamily: "var(--font-display)" }}
        >
          {title}
        </h1>
      )}
      {label && <p className="text-[13.5px] text-[var(--ink-mut)]">{label}</p>}
    </div>
  );
}

export default TransferRoute;
