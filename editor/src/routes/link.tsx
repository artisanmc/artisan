import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { useEffect, useMemo, useState } from "react";
import { useTranslation, Trans } from "react-i18next";
import { useAuthStore } from "@/state/authStore";
import {
  listNetworks,
  getNetwork,
  claimLinkCode,
  ClaimError,
  type NetworkSummary,
  type PackSummary,
} from "@/lib/api/networks";

export const Route = createFileRoute("/link")({ component: LinkRoute });

type Status = "loading" | "ready" | "claiming" | "done" | "error";
type Step = "network" | "pack" | "confirm";

function LinkRoute() {
  const { t } = useTranslation();
  const currentUser = useAuthStore((s) => s.currentUser);
  const isAuthLoading = useAuthStore((s) => s.isLoading);
  const navigate = useNavigate();
  const code = new URLSearchParams(window.location.search).get("code")?.toUpperCase() ?? null;

  const [status, setStatus] = useState<Status>("loading");
  const [errorMessage, setErrorMessage] = useState<string | null>(null);

  const [networks, setNetworks] = useState<NetworkSummary[]>([]);
  const [packsInNetwork, setPacksInNetwork] = useState<PackSummary[]>([]);

  // Picker state
  const [step, setStep] = useState<Step>("network");
  const [networkChoice, setNetworkChoice] = useState<
    { mode: "existing"; id: string } | { mode: "new"; name: string } | null
  >(null);
  const [packChoice, setPackChoice] = useState<
    { mode: "existing"; id: string } | { mode: "new"; name: string } | null
  >(null);
  const [serverKeyLabel, setServerKeyLabel] = useState("");

  // Bootstrap: bounce to login if needed, then fetch the user's networks.
  useEffect(() => {
    if (isAuthLoading) return;
    if (!currentUser) {
      navigate({ to: "/login", search: { next: `/link?code=${code}` } });
      return;
    }
    if (!code) {
      setStatus("error");
      setErrorMessage(t("linkPage.missingCode"));
      return;
    }
    listNetworks()
      .then((nets) => {
        setNetworks(nets);
        setStatus("ready");
      })
      .catch(() => {
        setStatus("error");
        setErrorMessage(t("linkPage.listError"));
      });
  }, [currentUser, isAuthLoading, code, navigate, t]);

  // When the user picks an existing network, fetch its packs so they can bind
  // to one of them in the pack step. New networks have no packs by definition.
  useEffect(() => {
    if (networkChoice?.mode !== "existing") {
      setPacksInNetwork([]);
      return;
    }
    let cancelled = false;
    getNetwork(networkChoice.id)
      .then((d) => {
        if (!cancelled) setPacksInNetwork(d.packs);
      })
      .catch(() => {
        if (!cancelled) setPacksInNetwork([]);
      });
    return () => { cancelled = true; };
  }, [networkChoice]);

  const handleClaim = async () => {
    if (!code || !networkChoice || !packChoice) return;
    setStatus("claiming");
    try {
      await claimLinkCode(code, {
        networkId: networkChoice.mode === "existing" ? networkChoice.id : undefined,
        networkName: networkChoice.mode === "new" ? networkChoice.name : undefined,
        packId: packChoice.mode === "existing" ? packChoice.id : undefined,
        packName: packChoice.mode === "new" ? packChoice.name : undefined,
        serverKeyLabel: serverKeyLabel.trim() || undefined,
      });
      setStatus("done");
    } catch (e) {
      setStatus("error");
      setErrorMessage(e instanceof ClaimError ? `linkPage.errors.${e.code}` : t("linkPage.unknownError"));
    }
  };

  if (status === "loading") {
    return <Shell><CenterMessage label={t("linkPage.loading")} /></Shell>;
  }
  if (status === "claiming") {
    return <Shell><CenterMessage label={t("linkPage.linking")} /></Shell>;
  }
  if (status === "done") {
    return (
      <Shell>
        <CardLayout
          eyebrow={t("linkPage.eyebrow")}
          title={t("linkPage.doneTitle")}
          tone="sage"
          body={t("linkPage.doneBody")}
        />
      </Shell>
    );
  }
  if (status === "error") {
    return (
      <Shell>
        <CardLayout
          eyebrow={t("linkPage.eyebrow")}
          title={t("linkPage.errorTitle")}
          tone="brick"
          body={
            <>
              <p>{errorMessage?.startsWith("linkPage.") ? t(errorMessage) : (errorMessage ?? t("linkPage.unknownError"))}</p>
              <p className="mt-2 text-[12.5px] text-[var(--ink-mut)]">
                <Trans
                  i18nKey="linkPage.retryHint"
                  components={{ 1: <code className="mono rounded bg-[var(--inset)] px-1.5 py-0.5 text-[var(--sand)]" /> }}
                  values={{ cmd: "/artisan setup" }}
                />
              </p>
            </>
          }
        />
      </Shell>
    );
  }

  // status === "ready" — picker UI
  return (
    <Shell>
      <div className="card flex flex-col gap-5 p-7">
        <div className="flex items-center gap-2.5">
          <span className="dot" style={{ background: "var(--terra)" }} />
          <span className="text-[10.5px] font-semibold uppercase tracking-[.18em] text-[var(--ink-mut)]">
            {t("linkPage.eyebrow")}
          </span>
        </div>

        <Stepper step={step} />

        {step === "network" && (
          <NetworkStep
            networks={networks}
            choice={networkChoice}
            onChoice={setNetworkChoice}
            onNext={() => setStep("pack")}
          />
        )}
        {step === "pack" && networkChoice && (
          <PackStep
            networkChoice={networkChoice}
            packs={packsInNetwork}
            choice={packChoice}
            onChoice={setPackChoice}
            onBack={() => setStep("network")}
            onNext={() => setStep("confirm")}
          />
        )}
        {step === "confirm" && networkChoice && packChoice && (
          <ConfirmStep
            networkChoice={networkChoice}
            networks={networks}
            packChoice={packChoice}
            packs={packsInNetwork}
            serverKeyLabel={serverKeyLabel}
            onServerKeyLabelChange={setServerKeyLabel}
            onBack={() => setStep("pack")}
            onConfirm={handleClaim}
          />
        )}
      </div>
    </Shell>
  );
}

function Stepper({ step }: { step: Step }) {
  const { t } = useTranslation();
  const items: { id: Step; label: string }[] = [
    { id: "network", label: t("linkPage.stepNetwork") },
    { id: "pack", label: t("linkPage.stepPack") },
    { id: "confirm", label: t("linkPage.stepConfirm") },
  ];
  const idx = items.findIndex((i) => i.id === step);
  return (
    <div className="flex items-center gap-2.5">
      {items.map((it, i) => {
        const isActive = i === idx;
        const isDone = i < idx;
        return (
          <div key={it.id} className="flex flex-1 items-center gap-2.5">
            <div className="flex flex-col items-center gap-1">
              <span
                className={[
                  "flex h-7 w-7 items-center justify-center rounded-full text-[11.5px] font-semibold transition-colors",
                  isActive
                    ? "border border-[var(--terra-line)] bg-[var(--terra-soft)] text-[var(--terra)]"
                    : isDone
                      ? "bg-[var(--terra)] text-[#2A130A]"
                      : "border border-[var(--line)] text-[var(--ink-faint)]",
                ].join(" ")}
              >
                {isDone ? "✓" : i + 1}
              </span>
              <span
                className={[
                  "text-[10.5px] font-semibold uppercase tracking-[.14em]",
                  isActive ? "text-[var(--ink)]" : isDone ? "text-[var(--ink-2)]" : "text-[var(--ink-faint)]",
                ].join(" ")}
              >
                {it.label}
              </span>
            </div>
            {i < items.length - 1 && (
              <div
                className="-mt-4 h-px flex-1"
                style={{ background: isDone ? "var(--terra)" : "var(--line-soft)" }}
              />
            )}
          </div>
        );
      })}
    </div>
  );
}

function NetworkStep({
  networks,
  choice,
  onChoice,
  onNext,
}: {
  networks: NetworkSummary[];
  choice: { mode: "existing"; id: string } | { mode: "new"; name: string } | null;
  onChoice: (c: { mode: "existing"; id: string } | { mode: "new"; name: string }) => void;
  onNext: () => void;
}) {
  const { t } = useTranslation();
  const [newName, setNewName] = useState(choice?.mode === "new" ? choice.name : "");
  const canProceed = (choice?.mode === "existing") || (choice?.mode === "new" && choice.name.trim().length > 0);

  return (
    <div className="flex flex-col gap-4">
      <h2 className="display text-[20px] text-[var(--ink)]" style={{ fontFamily: "var(--font-display)" }}>
        {t("linkPage.networkTitle")}
      </h2>

      {networks.length > 0 && (
        <ul className="flex flex-col gap-2">
          {networks.map((n) => {
            const isActive = choice?.mode === "existing" && choice.id === n.id;
            return (
              <li key={n.id}>
                <button
                  type="button"
                  onClick={() => onChoice({ mode: "existing", id: n.id })}
                  className={[
                    "flex w-full items-center justify-between rounded-[14px] border px-4 py-3 text-left transition-colors",
                    isActive
                      ? "border-[var(--terra-line)] bg-[var(--terra-soft)]"
                      : "border-[var(--line)] bg-[var(--inset)] hover:border-[var(--line-strong)]",
                  ].join(" ")}
                >
                  <span className="text-[13.5px] font-semibold text-[var(--ink)]">{n.name}</span>
                  {isActive && (
                    <span className="text-[11px] font-bold uppercase tracking-[.14em] text-[var(--terra)]">
                      {t("linkPage.selected")}
                    </span>
                  )}
                </button>
              </li>
            );
          })}
        </ul>
      )}

      <div className="rule" />

      <div className="flex flex-col gap-1.5">
        <span className="field-label">{t("linkPage.newNetworkLabel")}</span>
        <input
          className="input"
          placeholder="my_network"
          value={newName}
          onChange={(e) => {
            setNewName(e.target.value);
            if (e.target.value.trim().length > 0) {
              onChoice({ mode: "new", name: e.target.value });
            }
          }}
        />
      </div>

      <div className="flex justify-end border-t border-[var(--line-soft)] pt-4">
        <button type="button" onClick={onNext} disabled={!canProceed} className="btn btn-primary">
          {t("linkPage.next")}
        </button>
      </div>
    </div>
  );
}

function PackStep({
  networkChoice,
  packs,
  choice,
  onChoice,
  onBack,
  onNext,
}: {
  networkChoice: { mode: "existing"; id: string } | { mode: "new"; name: string };
  packs: PackSummary[];
  choice: { mode: "existing"; id: string } | { mode: "new"; name: string } | null;
  onChoice: (c: { mode: "existing"; id: string } | { mode: "new"; name: string }) => void;
  onBack: () => void;
  onNext: () => void;
}) {
  const { t } = useTranslation();
  const [newName, setNewName] = useState(choice?.mode === "new" ? choice.name : "");
  const canProceed = (choice?.mode === "existing") || (choice?.mode === "new" && choice.name.trim().length > 0);
  const isNewNetwork = networkChoice.mode === "new";

  return (
    <div className="flex flex-col gap-4">
      <h2 className="display text-[20px] text-[var(--ink)]" style={{ fontFamily: "var(--font-display)" }}>
        {t("linkPage.packTitle")}
      </h2>

      {isNewNetwork ? (
        <p className="text-[12.5px] text-[var(--ink-mut)]">
          {t("linkPage.newNetworkHasNoPacks")}
        </p>
      ) : packs.length > 0 ? (
        <ul className="flex flex-col gap-2">
          {packs.map((p) => {
            const isActive = choice?.mode === "existing" && choice.id === p.id;
            return (
              <li key={p.id}>
                <button
                  type="button"
                  onClick={() => onChoice({ mode: "existing", id: p.id })}
                  className={[
                    "flex w-full items-center justify-between rounded-[14px] border px-4 py-3 text-left transition-colors",
                    isActive
                      ? "border-[var(--terra-line)] bg-[var(--terra-soft)]"
                      : "border-[var(--line)] bg-[var(--inset)] hover:border-[var(--line-strong)]",
                  ].join(" ")}
                >
                  <span className="text-[13.5px] font-semibold text-[var(--ink)]">{p.name}</span>
                  {isActive && (
                    <span className="text-[11px] font-bold uppercase tracking-[.14em] text-[var(--terra)]">
                      {t("linkPage.selected")}
                    </span>
                  )}
                </button>
              </li>
            );
          })}
        </ul>
      ) : (
        <p className="text-[12.5px] text-[var(--ink-mut)]">{t("linkPage.networkHasNoPacks")}</p>
      )}

      {!isNewNetwork && packs.length > 0 && <div className="rule" />}

      <div className="flex flex-col gap-1.5">
        <span className="field-label">{t("linkPage.newPackLabel")}</span>
        <input
          className="input"
          placeholder="my_pack"
          value={newName}
          onChange={(e) => {
            setNewName(e.target.value);
            if (e.target.value.trim().length > 0) {
              onChoice({ mode: "new", name: e.target.value });
            }
          }}
        />
      </div>

      <div className="flex justify-between border-t border-[var(--line-soft)] pt-4">
        <button type="button" onClick={onBack} className="btn btn-ghost">{t("linkPage.back")}</button>
        <button type="button" onClick={onNext} disabled={!canProceed} className="btn btn-primary">
          {t("linkPage.next")}
        </button>
      </div>
    </div>
  );
}

function ConfirmStep({
  networkChoice,
  networks,
  packChoice,
  packs,
  serverKeyLabel,
  onServerKeyLabelChange,
  onBack,
  onConfirm,
}: {
  networkChoice: { mode: "existing"; id: string } | { mode: "new"; name: string };
  networks: NetworkSummary[];
  packChoice: { mode: "existing"; id: string } | { mode: "new"; name: string };
  packs: PackSummary[];
  serverKeyLabel: string;
  onServerKeyLabelChange: (v: string) => void;
  onBack: () => void;
  onConfirm: () => void;
}) {
  const { t } = useTranslation();
  const networkLabel = useMemo(() => {
    if (networkChoice.mode === "new") return `${networkChoice.name} (${t("linkPage.newSuffix")})`;
    return networks.find((n) => n.id === networkChoice.id)?.name ?? networkChoice.id;
  }, [networkChoice, networks, t]);
  const packLabel = useMemo(() => {
    if (packChoice.mode === "new") return `${packChoice.name} (${t("linkPage.newSuffix")})`;
    return packs.find((p) => p.id === packChoice.id)?.name ?? packChoice.id;
  }, [packChoice, packs, t]);

  return (
    <div className="flex flex-col gap-4">
      <h2 className="display text-[20px] text-[var(--ink)]" style={{ fontFamily: "var(--font-display)" }}>
        {t("linkPage.confirmTitle")}
      </h2>

      <dl className="flex flex-col gap-2 rounded-[14px] border border-[var(--line-soft)] bg-[var(--inset)] p-4">
        <SummaryRow label={t("linkPage.summaryNetwork")} value={networkLabel} />
        <SummaryRow label={t("linkPage.summaryPack")} value={packLabel} />
      </dl>

      <div className="flex flex-col gap-1.5">
        <span className="field-label">{t("linkPage.serverKeyLabel")}</span>
        <input
          className="input"
          placeholder={t("linkPage.serverKeyLabelPlaceholder")}
          value={serverKeyLabel}
          onChange={(e) => onServerKeyLabelChange(e.target.value)}
        />
        <span className="text-[11px] text-[var(--ink-faint)]">{t("linkPage.serverKeyLabelHint")}</span>
      </div>

      <div className="flex justify-between border-t border-[var(--line-soft)] pt-4">
        <button type="button" onClick={onBack} className="btn btn-ghost">{t("linkPage.back")}</button>
        <button type="button" onClick={onConfirm} className="btn btn-primary">
          {t("linkPage.confirm")}
        </button>
      </div>
    </div>
  );
}

function SummaryRow({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex items-baseline justify-between gap-3">
      <dt className="text-[10.5px] font-semibold uppercase tracking-[.14em] text-[var(--ink-faint)]">
        {label}
      </dt>
      <dd className="truncate text-[13px] font-medium text-[var(--ink)]">{value}</dd>
    </div>
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

function CenterMessage({ label }: { label: string }) {
  return (
    <div className="card flex items-center justify-center p-8 text-[var(--ink-mut)]">{label}</div>
  );
}

function CardLayout({
  eyebrow,
  title,
  body,
  tone,
}: {
  eyebrow: string;
  title: string;
  body: React.ReactNode;
  tone?: "sage" | "brick";
}) {
  const dotColor =
    tone === "sage" ? "var(--sage)" : tone === "brick" ? "var(--brick)" : "var(--terra)";
  return (
    <div className="card flex flex-col gap-5 p-7">
      <div className="flex items-center gap-2.5">
        <span className="dot" style={{ background: dotColor }} />
        <span className="text-[10.5px] font-semibold uppercase tracking-[.18em] text-[var(--ink-mut)]">
          {eyebrow}
        </span>
      </div>
      <h1
        className="display text-[24px] tracking-tight text-[var(--ink)]"
        style={{ fontFamily: "var(--font-display)" }}
      >
        {title}
      </h1>
      <div className="text-[13.5px] leading-relaxed text-[var(--ink-2)]">{body}</div>
    </div>
  );
}

export default LinkRoute;
